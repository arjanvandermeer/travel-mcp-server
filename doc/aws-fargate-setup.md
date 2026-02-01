# AWS Fargate Deployment Setup

This guide sets up ECS Fargate with RDS PostgreSQL for the travel-mcp-server.

## Prerequisites

- AWS CLI installed and configured (`aws configure`)
- Docker installed locally
- GitHub repository with secrets configured

## Architecture

```
Internet → ALB (443) → ECS Fargate (3000) → RDS PostgreSQL (5432)
```

## Step 1: Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name travel-mcp-server \
  --region us-east-1
```

## Step 2: Create VPC and Networking (if needed)

Use default VPC or create a new one. Note your:
- VPC ID
- Subnet IDs (need at least 2 for ALB)
- Security Group IDs

## Step 3: Create RDS PostgreSQL

```bash
# Create a security group for RDS
aws ec2 create-security-group \
  --group-name travel-mcp-rds-sg \
  --description "Security group for travel-mcp RDS" \
  --vpc-id <your-vpc-id>

# Allow PostgreSQL from ECS (you'll update this after creating ECS SG)
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
  --master-user-password <your-secure-password> \
  --allocated-storage 20 \
  --vpc-security-group-ids <rds-sg-id> \
  --no-publicly-accessible
```

## Step 3b: Prepare the Database

See [database-setup.md](database-setup.md) for detailed PostgreSQL setup instructions.

For RDS, connect with `?sslmode=require`:

```bash
psql "postgresql://postgres:<master-password>@<rds-endpoint>:5432/postgres?sslmode=require"
```

Then follow the steps in database-setup.md to create the database, user, and enable PostGIS.

## Step 4: Create ECS Cluster

```bash
aws ecs create-cluster --cluster-name travel-mcp-cluster
```

## Step 5: Create Task Execution Role

```bash
# Create the role
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

# Attach the policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

## Step 6: Create Task Definition

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
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "DATABASE_URL", "value": "postgresql://traveluser:<password>@<rds-endpoint>:5432/travel?sslmode=no-verify"}
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
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

Register the task:

```bash
# Create log group first
aws logs create-log-group --log-group-name /ecs/travel-mcp-server

# Register task definition
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

## Step 7: Create Application Load Balancer

```bash
# Create security group for ALB
aws ec2 create-security-group \
  --group-name travel-mcp-alb-sg \
  --description "Security group for travel-mcp ALB"

# Allow HTTP/HTTPS from anywhere
aws ec2 authorize-security-group-ingress \
  --group-id <alb-sg-id> \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id <alb-sg-id> \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

# Create ALB
aws elbv2 create-load-balancer \
  --name travel-mcp-alb \
  --subnets <subnet-1> <subnet-2> \
  --security-groups <alb-sg-id> \
  --type application

# Create target group
aws elbv2 create-target-group \
  --name travel-mcp-targets \
  --protocol HTTP \
  --port 3000 \
  --vpc-id <vpc-id> \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30

# Create listener
aws elbv2 create-listener \
  --load-balancer-arn <alb-arn> \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=<target-group-arn>
```

## Step 8: Create ECS Service

```bash
# Create security group for ECS tasks
aws ec2 create-security-group \
  --group-name travel-mcp-ecs-sg \
  --description "Security group for travel-mcp ECS tasks"

# Allow traffic from ALB
aws ec2 authorize-security-group-ingress \
  --group-id <ecs-sg-id> \
  --protocol tcp \
  --port 3000 \
  --source-group <alb-sg-id>

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

## Step 9: Configure GitHub Actions

The deployment workflow (`.github/workflows/deploy.yml`) requires configuration via GitHub's repository settings.

### GitHub Variables (non-sensitive config)

Go to: Settings → Secrets and variables → Actions → **Variables** tab

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `AWS_REGION` | AWS region for deployment | `us-east-1` |
| `ECR_REPOSITORY` | ECR repository name | `travel-mcp-server` |
| `ECS_CLUSTER` | ECS cluster name | `travel-mcp-cluster` |
| `ECS_SERVICE` | ECS service name | `travel-mcp-service` |
| `CONTAINER_NAME` | Container name in task definition | `travel-mcp-server` |
| `SENTRY_ORG` | Sentry organization slug | `your-org` |
| `SENTRY_PROJECT` | Sentry project slug | `travel-mcp-server` |

### GitHub Secrets (sensitive values)

Go to: Settings → Secrets and variables → Actions → **Secrets** tab

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key | AWS IAM Console |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key | AWS IAM Console |
| `SENTRY_DSN` | Sentry DSN for error tracking | Sentry → Project Settings → Client Keys |
| `SENTRY_AUTH_TOKEN` | Sentry auth token for releases (optional) | Sentry → Settings → Auth Tokens (needs `project:releases`, `org:read` scopes) |

### IAM Permissions

The IAM user needs permissions for:
- ECR: `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`
- ECS: `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DescribeServices`

### Deployment Flow

1. Push to `main` triggers the workflow
2. Workflow builds Docker image and pushes to ECR
3. Downloads current task definition from ECS
4. Injects `SENTRY_DSN` and telemetry env vars
5. Updates task definition with new image
6. Deploys to ECS with rolling update

### Telemetry Environment Variables

The workflow automatically injects these into the ECS task definition:

| Variable | Value | Purpose |
|----------|-------|---------|
| `SENTRY_DSN` | From secrets | Sentry error tracking |
| `TELEMETRY_ENABLED` | `true` | Enable telemetry |
| `TELEMETRY_ENVIRONMENT` | `production` | Environment tag in Sentry |
| `TELEMETRY_SAMPLE_RATE` | `1.0` | 100% trace sampling |

Note: `DATABASE_URL` is set directly in the ECS task definition (not injected by workflow) and should be configured via AWS Console or Secrets Manager.

## Step 10: First Deployment

Build and push the initial image manually:

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t travel-mcp-server .
docker tag travel-mcp-server:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/travel-mcp-server:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/travel-mcp-server:latest
```

After this, pushing to `main` branch triggers automatic deployment.

## Useful Commands

```bash
# View service status
aws ecs describe-services --cluster travel-mcp-cluster --services travel-mcp-service

# View running tasks
aws ecs list-tasks --cluster travel-mcp-cluster --service-name travel-mcp-service

# View logs
aws logs tail /ecs/travel-mcp-server --follow

# Force new deployment
aws ecs update-service --cluster travel-mcp-cluster --service travel-mcp-service --force-new-deployment

# Scale up/down
aws ecs update-service --cluster travel-mcp-cluster --service travel-mcp-service --desired-count 2
```

## Cost Estimate (us-east-1)

| Resource | Spec | ~Monthly Cost |
|----------|------|---------------|
| Fargate | 0.25 vCPU, 0.5GB | ~$10 |
| RDS PostgreSQL | db.t3.micro | ~$15 |
| ALB | Basic usage | ~$20 |
| Data transfer | Varies | ~$5 |
| **Total** | | **~$50/month** |

## Security Notes

- Use AWS Secrets Manager for database credentials in production
- Enable HTTPS on ALB with ACM certificate
- Restrict RDS to only accept connections from ECS security group
- Use private subnets for ECS tasks in production
