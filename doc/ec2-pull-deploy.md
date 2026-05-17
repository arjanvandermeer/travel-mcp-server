# EC2 Pull Deploy

The production EC2 instance can run a pull-based deploy agent. The instance checks GitHub, deploys exact commit SHAs that are safe to run, restarts local services, health-checks them, rolls back on failure, and blocks the failed SHA so it is not retried forever.

This is intentionally pull-based: GitHub Actions does not SSH into production. The EC2 instance initiates outbound HTTPS to GitHub.

## Repositories

Configured in `ops/ec2-pull-deploy.config.json`:

- `travel-mcp-server`
  - Path: `/home/ubuntu/travel-mcp-server`
  - GitHub: `arjanvandermeer/travel-mcp-server`
  - Service: `travel-mcp-server.service`
  - Health: `http://127.0.0.1:3000/health`
  - CI gate: required, workflow `CI`

- `thai-transliterate`
  - Path: `/home/ubuntu/Development/thai-transliterate`
  - GitHub: `arjanvandermeer/thai-transliterate-js`
  - Service: none; this is a library checkout
  - Deploy action: pull exact SHA, `npm ci`, `npm test`

- `thai-transliterate-mcp`
  - Path: `/home/ubuntu/thai-transliterate-mcp`
  - GitHub: `arjanvandermeer/thai-transliterate-mcp`
  - Service: `thai-transliterate-mcp.service`
  - Health: `http://127.0.0.1:3001/health`

## Safety Rules

- Dirty EC2 worktrees are never deployed. The agent stops for that repo and logs the dirty files.
- The agent deploys the exact SHA fetched from `origin/main`, not a floating local branch.
- `travel-mcp-server` only deploys after GitHub Actions has a successful `CI` push run for that exact SHA.
- If a deploy or health check fails, the agent checks out the previous SHA, reinstalls, restarts the service, and health-checks the rollback.
- The failed target SHA is recorded in `/var/lib/ec2-pull-deploy/state.json` and skipped until a newer commit appears.
- A lock file at `/var/lock/ec2-pull-deploy.lock` prevents overlapping deploy runs.

## Install On EC2

From a fresh checkout of `travel-mcp-server` on EC2:

```bash
sudo cp /home/ubuntu/travel-mcp-server/ops/systemd/ec2-pull-deploy.service /etc/systemd/system/ec2-pull-deploy.service
sudo cp /home/ubuntu/travel-mcp-server/ops/systemd/ec2-pull-deploy.timer /etc/systemd/system/ec2-pull-deploy.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ec2-pull-deploy.timer
```

If GitHub API rate limits become a problem, create `/etc/ec2-pull-deploy.env`:

```bash
GITHUB_TOKEN=github_pat_or_fine_grained_token_with_read_only_repo_metadata
```

The repos are currently public enough for unauthenticated GitHub API reads, so this file is optional.

## Manual Run

```bash
sudo systemctl start ec2-pull-deploy.service
sudo journalctl -u ec2-pull-deploy.service -n 200 --no-pager
```

Or directly:

```bash
sudo node /home/ubuntu/travel-mcp-server/scripts/ec2-pull-deploy.js \
  --config /home/ubuntu/travel-mcp-server/ops/ec2-pull-deploy.config.json
```

## Operational Notes

The Thai transliteration library is a repo on the EC2 instance, but it is not a running systemd service. Updating that checkout does not automatically change `thai-transliterate-mcp` unless the MCP repo also updates its dependency or is otherwise wired to use the local checkout.

Before enabling the timer, resolve any dirty worktrees on EC2. At the time this runbook was added, these repos had local changes and would be skipped by the agent:

- `/home/ubuntu/Development/thai-transliterate`
- `/home/ubuntu/thai-transliterate-mcp`

That refusal is deliberate. The agent should never overwrite hand-edited production files.
