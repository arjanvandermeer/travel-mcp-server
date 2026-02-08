# ECS Fargate Setup

Everything that runs on ECS Fargate: initial infrastructure setup, the MCP server service, and one-off maintenance tasks.

## Architecture

```
                          ┌─────────────────────────────────────────────┐
                          │              ECS Fargate Cluster            │
                          │              travel-mcp-cluster             │
Internet ─→ Cloudflare    │                                             │
         ─→ ALB ──────────┼─→ Service: travel-mcp-service              │
                          │     Task: travel-mcp-task (0.25 vCPU/512MB) │
                          │     Container: travel-mcp-server            │
                          │     Runs: node src/index-http.js            │
                          │                                             │
            Manual/Cron ──┼─→ One-off: travel-import-task (2 vCPU/8GB) │
                          │     Container: import                       │
                          │     Runs: import / refresh / optimize       │
                          └──────────────┬──────────────────────────────┘
                                         │
                                         ▼
                               RDS PostgreSQL + PostGIS
                               travel-postgres (db.t3.micro)
```

## Infrastructure Reference

| Resource | Value |
|----------|-------|
| AWS Account | See `.env.aws` → `AWS_ACCOUNT_ID` |
| Region | `us-east-1` |
| ECR Image | `<account-id>.dkr.ecr.us-east-1.amazonaws.com/travel-mcp-server` |
| ECS Cluster | `travel-mcp-cluster` |
| VPC | See `.env.aws` → `VPC_ID` |
| Subnet 1 | See `.env.aws` → `SUBNET_1` |
| Subnet 2 | See `.env.aws` → `SUBNET_2` |
| ALB SG | See `.env.aws` → `ALB_SECURITY_GROUP` |
| ECS SG | See `.env.aws` → `ECS_SECURITY_GROUP` |
| RDS SG | See `.env.aws` → `RDS_SECURITY_GROUP` |
| RDS Endpoint | See `.env.aws` → `RDS_ENDPOINT` |
| ALB DNS | See `.env.aws` → `ALB_ARN` |
| Public URL | `https://mcp.arjanvandermeer.com` |

Network configuration (reused across all `run-task` commands):

```bash
# Values from .env.aws
NETWORK="awsvpcConfiguration={subnets=[$SUBNET_1,$SUBNET_2],securityGroups=[$ECS_SECURITY_GROUP],assignPublicIp=ENABLED}"
```

---

## Part 1: Initial Infrastructure Setup

One-time steps to create the AWS resources from scratch.

### 1. Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name travel-mcp-server \
  --region us-east-1
```

### 2. Create VPC and Networking

Use default VPC or create a new one. Note your VPC ID, Subnet IDs (at least 2 for ALB), and Security Group IDs.

### 3. Create RDS PostgreSQL

```bash
# Create a security group for RDS
aws ec2 create-security-group \
  --group-name travel-mcp-rds-sg \
  --description "Security group for travel-mcp RDS" \
  --vpc-id <your-vpc-id>

# Allow PostgreSQL from ECS (update after creating ECS SG)
aws ec2 authorize-security-group-ingress \
  --group-id <rds-sg-id> \
  --protocol tcp \
  --port 5432 \
  --source-group <ecs-sg-id>

# Create RDS instance
aws rds create-db-instance \
  --db-instance-identifier travel-postgres \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username postgres \
  --master-user-password <password> \
  --allocated-storage 20 \
  --vpc-security-group-ids <rds-sg-id> \
  --no-publicly-accessible
```

Then prepare the database — see [database-setup.md](database-setup.md). Connect with `?sslmode=require`:

```bash
psql "postgresql://postgres:<password>@<rds-endpoint>:5432/postgres?sslmode=require"
```

### 4. Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name travel-mcp-cluster
```

### 5. Create Task Execution Role

```bash
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### 6. Create Application Load Balancer

```bash
# Create security group for ALB
aws ec2 create-security-group \
  --group-name travel-mcp-alb-sg \
  --description "Security group for travel-mcp ALB"

# Allow HTTP/HTTPS
aws ec2 authorize-security-group-ingress \
  --group-id <alb-sg-id> --protocol tcp --port 80 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id <alb-sg-id> --protocol tcp --port 443 --cidr 0.0.0.0/0

# Create ALB
aws elbv2 create-load-balancer \
  --name travel-mcp-alb \
  --subnets <subnet-1> <subnet-2> \
  --security-groups <alb-sg-id> \
  --type application

# Create target group
aws elbv2 create-target-group \
  --name travel-mcp-targets \
  --protocol HTTP --port 3000 \
  --vpc-id <vpc-id> --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn <alb-arn> \
  --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn=<target-group-arn>
```

### 7. Register Server Task Definition

Save as `task-definition.json`:

```json
{
  "family": "travel-mcp-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::<account-id>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "travel-mcp-server",
      "image": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/travel-mcp-server:latest",
      "portMappings": [
        { "containerPort": 3000, "protocol": "tcp" }
      ],
      "environment": [
        {"name": "DATABASE_URL", "value": "postgresql://<user>:<password>@<rds-endpoint>:5432/travel?sslmode=no-verify"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/travel-mcp-server",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1"],
        "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 60
      }
    }
  ]
}
```

```bash
aws logs create-log-group --log-group-name /ecs/travel-mcp-server
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### 8. Create ECS Service

```bash
# Create security group for ECS tasks
aws ec2 create-security-group \
  --group-name travel-mcp-ecs-sg \
  --description "Security group for travel-mcp ECS tasks"

# Allow traffic from ALB
aws ec2 authorize-security-group-ingress \
  --group-id <ecs-sg-id> --protocol tcp --port 3000 --source-group <alb-sg-id>

# Create service
aws ecs create-service \
  --cluster travel-mcp-cluster \
  --service-name travel-mcp-service \
  --task-definition travel-mcp-task \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet-1>,<subnet-2>],securityGroups=[<ecs-sg-id>],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=<target-group-arn>,containerName=travel-mcp-server,containerPort=3000"
```

### 9. First Deployment

Build and push the initial image manually:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker build -t travel-mcp-server .
docker tag travel-mcp-server:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/travel-mcp-server:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/travel-mcp-server:latest
```

After this, pushing to `main` triggers automatic deployment via GitHub Actions.

---

## Part 2: MCP Server Service

The always-running HTTP/SSE MCP server, deployed automatically via CI/CD.

### Task Definition: `travel-mcp-task`

| Setting | Value |
|---------|-------|
| CPU | 256 (0.25 vCPU) |
| Memory | 512 MB |
| Container | `travel-mcp-server` |
| Command | `node src/index-http.js` |
| Port | 3000 |
| Health check | `GET /health` |

### CI/CD Deployment

Pushing to `main` triggers GitHub Actions (`.github/workflows/deploy.yml`):

1. Runs unit tests
2. Builds Docker image, pushes to ECR
3. Injects `SENTRY_DSN` and telemetry env vars into task definition
4. Updates ECS service with rolling deployment

#### GitHub Variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Value |
|----------|-------|
| `AWS_REGION` | `us-east-1` |
| `ECR_REPOSITORY` | `travel-mcp-server` |
| `ECS_CLUSTER` | `travel-mcp-cluster` |
| `ECS_SERVICE` | `travel-mcp-service` |
| `CONTAINER_NAME` | `travel-mcp-server` |
| `SENTRY_ORG` | your Sentry org slug |
| `SENTRY_PROJECT` | `travel-mcp-server` |

#### GitHub Secrets (Settings → Secrets and variables → Actions → Secrets)

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `SENTRY_DSN` | Sentry DSN for error tracking |
| `SENTRY_AUTH_TOKEN` | Sentry auth token for releases (optional) |

#### IAM Permissions

The IAM user needs:
- ECR: `GetAuthorizationToken`, `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage`, `PutImage`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`
- ECS: `DescribeTaskDefinition`, `RegisterTaskDefinition`, `UpdateService`, `DescribeServices`

#### Telemetry Environment Variables (injected by CI/CD)

| Variable | Value |
|----------|-------|
| `SENTRY_DSN` | From secrets |
| `TELEMETRY_ENABLED` | `true` |
| `TELEMETRY_ENVIRONMENT` | `production` |
| `TELEMETRY_SAMPLE_RATE` | `1.0` |

`DATABASE_URL` is set directly in the ECS task definition, not injected by CI/CD.

### Manual Server Operations

```bash
# View service status
aws ecs describe-services --cluster travel-mcp-cluster --services travel-mcp-service

# View running tasks
aws ecs list-tasks --cluster travel-mcp-cluster --service-name travel-mcp-service

# Tail server logs
aws logs tail /ecs/travel-mcp-server --follow

# Force new deployment (same image, fresh task)
aws ecs update-service --cluster travel-mcp-cluster --service travel-mcp-service --force-new-deployment

# Scale up/down
aws ecs update-service --cluster travel-mcp-cluster --service travel-mcp-service --desired-count 2
```

---

## Part 3: Maintenance Tasks

One-off Fargate tasks for data import, refresh, and database optimization. All use the same task definition with different command overrides.

### Available Jobs

| Job | Script | Purpose | Typical Duration |
|-----|--------|---------|-----------------|
| **Import** | `src/import-osm-pbf.js` | Download and import OSM PBF data for a country | 5 min - 3 hours |
| **Refresh** | `src/refresh-imports.js` | Re-import stale regions based on `refresh_interval_days` | Depends on stale count |
| **Optimize** | `src/optimize-db.js` | VACUUM ANALYZE and optional REINDEX after imports | 1-5 min |

### One-Time Setup

**Create CloudWatch log group:**

```bash
aws logs create-log-group --log-group-name /ecs/travel-import --region us-east-1
```

**Register the task definition** — save as `task-definition-import.json`:

```json
{
  "family": "travel-import-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "8192",
  "ephemeralStorage": {
    "sizeInGiB": 50
  },
  "executionRoleArn": "arn:aws:iam::<account-id>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "import",
      "image": "<account-id>.dkr.ecr.us-east-1.amazonaws.com/travel-mcp-server:latest",
      "command": ["echo", "Provide command override when running task"],
      "essential": true,
      "environment": [
        {
          "name": "DATABASE_URL",
          "value": "postgresql://<user>:<password>@<rds-endpoint>:5432/travel?sslmode=no-verify"
        },
        {
          "name": "TELEMETRY_ENABLED",
          "value": "true"
        },
        {
          "name": "TELEMETRY_ENVIRONMENT",
          "value": "production"
        },
        {
          "name": "TELEMETRY_SAMPLE_RATE",
          "value": "1.0"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/travel-import",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "import"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://task-definition-import.json
```

### Import a Country

```bash
aws ecs run-task \
  --cluster travel-mcp-cluster \
  --task-definition travel-import-task \
  --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{
    "containerOverrides": [{
      "name": "import",
      "command": ["node", "src/import-osm-pbf.js", "germany", "all"]
    }]
  }'
```

Replace `germany` with any keyword from `import_sources` (e.g., `thailand`, `france`, `japan`).

Replace `all` with a specific POI type if needed (e.g., `hotel`, `restaurant`).

> **Note:** The import script downloads PBF files to the `data/` subdirectory inside the container (writable by the non-root user). This requires a Docker image built after the Dockerfile fix that creates `/app/data`. If running on an older image, use this workaround instead:
> ```bash
> "command": ["sh", "-c", "cd /tmp && node /app/src/import-osm-pbf.js germany all"]
> ```

### Refresh Stale Imports

The refresh script checks `import_sources` for regions that are due for re-import based on their `refresh_interval_days` setting, then runs the import for each stale region sequentially.

**Refresh all stale regions:**

```bash
aws ecs run-task \
  --cluster travel-mcp-cluster \
  --task-definition travel-import-task \
  --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{
    "containerOverrides": [{
      "name": "import",
      "command": ["node", "src/refresh-imports.js"]
    }]
  }'
```

**Refresh with optimization after imports:**

```bash
"command": ["node", "src/refresh-imports.js", "--optimize"]
```

**Refresh a specific region (force even if not stale):**

```bash
"command": ["node", "src/refresh-imports.js", "--region=thailand", "--force"]
```

**Limit number of regions (useful for cost control):**

```bash
"command": ["node", "src/refresh-imports.js", "--max=3"]
```

**Dry run (see what would be refreshed without importing):**

```bash
"command": ["node", "src/refresh-imports.js", "--dry-run"]
```

**List all import sources and their status:**

```bash
"command": ["node", "src/refresh-imports.js", "--list"]
```

### Optimize Database

Run after large imports to reclaim space and update query planner statistics.

**Standard optimization (VACUUM ANALYZE):**

```bash
aws ecs run-task \
  --cluster travel-mcp-cluster \
  --task-definition travel-import-task \
  --launch-type FARGATE \
  --network-configuration "$NETWORK" \
  --overrides '{
    "containerOverrides": [{
      "name": "import",
      "command": ["node", "src/optimize-db.js"]
    }]
  }'
```

**Full vacuum with reindex (locks tables, reclaims more space):**

```bash
"command": ["node", "src/optimize-db.js", "--full", "--reindex"]
```

**Optimize a specific table only:**

```bash
"command": ["node", "src/optimize-db.js", "--table=osm_pois"]
```

### Monitoring Maintenance Tasks

```bash
# Tail logs in real-time
aws logs tail /ecs/travel-import --follow

# Check task status
aws ecs describe-tasks \
  --cluster travel-mcp-cluster \
  --tasks <task-arn-from-run-task-output>

# Check import progress via database
psql "$DATABASE_URL" -c "SELECT id, import_type, region_name, status, records_imported, started_at, completed_at FROM import_log ORDER BY id DESC LIMIT 5;"

# Check which regions are stale
psql "$DATABASE_URL" -c "SELECT keyword, display_name, last_imported_at, refresh_interval_days FROM import_sources WHERE enabled = true ORDER BY last_imported_at ASC NULLS FIRST;"
```

### Resource Sizing for Imports

The default task definition (2 vCPU / 8 GB / 50 GiB storage) handles most jobs. Adjust for large imports:

| Country Size | PBF Size | CPU | Memory | Ephemeral Storage | Duration |
|-------------|----------|-----|--------|-------------------|----------|
| Small (Singapore, Monaco) | < 100 MB | 1024 | 4096 | 20 GiB | < 5 min |
| Medium (Thailand, Netherlands) | 100 MB - 1 GB | 2048 | 8192 | 30 GiB | 5-15 min |
| Large (Germany, France) | 1 - 5 GB | 2048 | 8192 | 50 GiB | 30-60 min |
| Very Large (USA, Russia) | 5 - 15 GB | 4096 | 16384 | 100 GiB | 1-3 hours |

To adjust CPU/memory for a specific run:

```bash
--overrides '{
  "containerOverrides": [{
    "name": "import",
    "command": ["node", "src/import-osm-pbf.js", "usa", "all"],
    "cpu": 4096,
    "memory": 16384
  }]
}'
```

Note: `ephemeralStorage` cannot be overridden at run time. For very large countries, register a separate task definition revision with more storage.

Refresh and optimize jobs are lightweight — the default sizing is fine regardless of data size.

---

## Cost Estimate

| Resource | Spec | ~Monthly Cost |
|----------|------|---------------|
| Fargate (server) | 0.25 vCPU, 0.5 GB, always-on | ~$10 |
| Fargate (imports) | 2 vCPU, 8 GB, on-demand | ~$0.13/hr per run |
| RDS PostgreSQL | db.t3.micro, 20 GB | ~$15 |
| ALB | Basic usage | ~$20 |
| Data transfer | Varies | ~$5 |
| **Total (base)** | | **~$50/month** |

## Security Notes

- Use AWS Secrets Manager for database credentials in production
- Enable HTTPS on ALB with ACM certificate (currently handled by Cloudflare Flexible SSL)
- RDS only accepts connections from ECS security group
- Consider private subnets for ECS tasks with a NAT gateway

## Notes

- **Two task definitions, one image**: `travel-mcp-task` (server) and `travel-import-task` (jobs) both use the same `travel-mcp-server:latest` ECR image
- **Security group** (ECS SG from `.env.aws`) already allows access to RDS
- **`assignPublicIp=ENABLED`** is required for pulling ECR images and downloading PBF files (no NAT gateway)
- The import script tracks progress in `import_log` and supports abort detection, so concurrent runs for the same region are safe
- The refresh script runs imports sequentially, spawning `import-osm-pbf.js` as a child process for each stale region
- The `--optimize` flag on refresh automatically runs `optimize-db.js` after all imports complete
