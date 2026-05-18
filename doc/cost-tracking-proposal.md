# Cost Tracking Proposal

## Goal

Build a local-first cost tracking system for the Travel MCP Server that shows operational spend over time across every paid provider used by production:

- AWS
- Google Cloud and Google Maps Platform
- Cloudflare
- OpenAI
- Anthropic, if used by local review agents
- Sentry
- GitHub, if paid Actions, storage, or Copilot usage becomes relevant
- Any future API provider discovered from production configuration

The system should answer:

- What did we spend today, yesterday, this week, and this month?
- Which provider, service, project, API key, route, job, or feature is responsible?
- Are we approaching daily/monthly budgets?
- Did a code change or background job cause a spend spike?
- Which configured production API keys imply billable services that are not yet tracked?

## Principle

Costs should be tracked from provider billing APIs where available, and enriched with local usage counters where billing APIs are delayed, incomplete, or too coarse.

The tracker should not scrape dashboards and should not store raw API keys. It should discover which providers are configured in production, then use explicitly configured read-only billing credentials to fetch cost data.

## Provider Coverage

### AWS

Primary source:

- AWS Cost Explorer API.

Tracked dimensions:

- daily unblended cost
- service breakdown, for example EC2, RDS, data transfer, CloudWatch
- linked account, region, usage type
- tags if production resources are tagged

Likely production relevance:

- EC2 instance
- EBS volume
- data transfer
- CloudWatch logs/metrics, if enabled
- snapshots/backups, if configured

Required credentials:

- read-only IAM access with Cost Explorer permissions
- ideally no permissions to mutate infrastructure

Suggested permissions:

- `ce:GetCostAndUsage`
- `ce:GetDimensionValues`
- `ce:GetTags`
- `ce:GetCostForecast`

### Google Cloud And Google Maps Platform

Primary sources:

- Cloud Billing export to BigQuery, preferred for exact historical reporting.
- Cloud Billing Budget API for budget state.
- Local `google_api_usage` table for near-real-time Places API call counts.

Tracked dimensions:

- project
- service
- SKU
- API method where available
- date
- currency

Likely production relevance:

- Google Places API Nearby Search
- Google Places API Text Search
- Google Places API Place Details
- Google OAuth, usually free but still worth detecting

Notes:

- Google billing data is usually delayed.
- The app already stores daily Google Places call counts in `google_api_usage`; this should power same-day estimates.
- Exact spend should come from billing export once configured.

Required credentials:

- BigQuery read access to the billing export dataset, or billing account viewer access.
- No API key values should be stored in the tracker.

### Cloudflare

Primary sources:

- Cloudflare GraphQL Analytics API.
- Cloudflare account billing/subscription APIs where available.
- Local config for known Cloudflare-managed components.

Tracked dimensions:

- Workers requests
- Workers CPU time
- Durable Objects, KV, R2, D1, Queues, if introduced
- bandwidth and cached/uncached traffic
- zone or account

Likely production relevance:

- OAuth Worker
- DNS/proxy traffic
- future Workers-based agents or MCP endpoints

Required credentials:

- Cloudflare API token with read-only analytics and account access.

### OpenAI

Primary sources:

- OpenAI usage and cost APIs, when available for the organization/project.
- Local run metadata from scheduled local review agents.

Tracked dimensions:

- model
- project
- API key identifier, never the raw key
- input tokens
- output tokens
- cached tokens, when available
- cost
- local job or feature name

Likely production relevance:

- local weekly code review agent
- any future production AI enrichment, summarization, or agent flows

Required credentials:

- read-only usage/cost access where supported
- local agent wrapper should record job name, model, token counts, and run id

### Anthropic

Primary sources:

- Anthropic usage/admin APIs if available.
- Local agent wrapper metadata when Claude is used locally.

Tracked dimensions:

- model
- input tokens
- output tokens
- cache read/write tokens if exposed
- cost estimate
- local job or feature name

Status:

- GitHub Actions Claude review was removed.
- Track Anthropic only if local review or other local agents use it.

### Sentry

Primary sources:

- Sentry organization/project API.
- Sentry plan and usage endpoints where available.

Tracked dimensions:

- errors/events
- transactions
- spans
- profiles
- replays, if enabled later
- attachments, if enabled later
- monitor checks, if used
- project
- environment
- quota usage versus plan limits

Likely production relevance:

- backend exceptions
- HTTP and Postgres tracing
- profiling at `profilesSampleRate`
- breadcrumbs and custom messages

Cost risks:

- high trace sample rate can create large transaction volume
- profiling can multiply observability cost
- noisy auth failures or background job loops can inflate event counts
- storing high-cardinality tags can make investigation harder even when not directly billed

Required credentials:

- Sentry auth token with read-only organization/project usage access.

Recommended production controls:

- record current `tracesSampleRate`, `profilesSampleRate`, and environment
- alert when event/transaction usage exceeds daily budget
- track cost or quota impact per release
- create a local issue when Sentry approaches plan quota

### GitHub

Primary sources:

- GitHub billing APIs for Actions/package/storage if needed.
- GitHub Actions run history for CI volume.

Current status:

- Only deterministic CI remains.
- AI code reviews no longer run in GitHub Actions.

Tracked dimensions:

- Actions minutes
- workflow run count
- storage, if artifacts/caches become material

## Credential Discovery

The system should inspect production configuration to discover which providers are active, but it should not infer spend access from application secrets alone.

Discovery inputs:

- production `app_config`
- environment variable names
- deployment service files
- known config keys in `data/schema.sql`
- enabled features in code

Examples:

- `google_places_api_key` means Google Maps Platform should be tracked.
- `SENTRY_DSN` means Sentry should be tracked.
- `OPENAI_API_KEY` means OpenAI should be tracked.
- Cloudflare OAuth issuer or worker configuration means Cloudflare should be tracked.
- AWS deployment host or metadata means AWS should be tracked.

Security rule:

- discovery may record that a provider is configured
- discovery must never persist raw secret values
- discovery should store only key fingerprints, for example provider, last four characters, source, and first seen date

## Proposed Data Model

### `cost_providers`

Tracks provider configuration status.

Fields:

- `id`
- `provider` such as `aws`, `google`, `cloudflare`, `openai`, `anthropic`, `sentry`, `github`
- `display_name`
- `status`: `active`, `detected_missing_billing_access`, `disabled`, `unknown`
- `detected_from`
- `last_detected_at`
- `notes`

### `cost_credentials`

Tracks read-only billing credential metadata, not secret values.

Fields:

- `id`
- `provider`
- `credential_ref`
- `fingerprint`
- `scope`
- `status`
- `last_verified_at`
- `last_error`

### `cost_daily`

Canonical daily spend table.

Fields:

- `date`
- `provider`
- `service`
- `sku`
- `project_or_account`
- `region`
- `currency`
- `actual_cost`
- `estimated_cost`
- `usage_quantity`
- `usage_unit`
- `source`: `billing_api`, `local_estimate`, `manual`
- `source_updated_at`
- `metadata`

### `cost_usage_events`

Optional local event table for near-real-time estimates.

Fields:

- `created_at`
- `provider`
- `service`
- `feature`
- `operation`
- `quantity`
- `unit`
- `estimated_cost`
- `request_id`
- `user_id`, nullable
- `metadata`

Examples:

- Google Places enrichment consumed two API calls.
- Sentry emitted one error event.
- Local code review agent used a model and token count.

### `cost_budgets`

Budget thresholds.

Fields:

- `provider`
- `service`
- `period`: `daily`, `weekly`, `monthly`
- `currency`
- `soft_limit`
- `hard_limit`
- `notify_at_percent`
- `enabled`

## Collection Jobs

### Discovery Job

Runs locally or on the production host.

Responsibilities:

- detect configured providers
- update `cost_providers`
- warn when a provider is active but no billing reader is configured
- never print or persist raw secrets

### Provider Sync Job

Runs daily and on demand.

Responsibilities:

- fetch billing data from provider APIs
- normalize into `cost_daily`
- backfill the previous 7-14 days because billing APIs can settle late
- preserve both estimated and actual values

### Local Usage Estimator

Runs inside the app for services where local usage is already known.

Responsibilities:

- count Google Places API calls by SKU where possible
- record OpenAI/Anthropic token use from local agents
- record Sentry event/transaction/profile volume if available from API
- provide same-day estimates before provider billing data arrives

## UI And Reports

Start with a CLI report, then add a small admin page if useful.

CLI examples:

```bash
npm run costs -- --days=7
npm run costs -- --provider=google --days=30
npm run costs:discover
npm run costs:sync
```

Report sections:

- total spend by day
- spend by provider
- spend by service/SKU
- estimated versus actual
- budget status
- newly detected untracked providers
- anomalies versus previous 7-day average

Example output:

```text
Cost summary, last 7 days

Total actual:     $12.84
Total estimated:  $3.20 pending billing settlement

Provider breakdown
- AWS:       $8.12
- Google:    $3.84
- Sentry:    $0.88
- OpenAI:    $0.00
- Cloudflare:$0.00

Warnings
- Sentry traces are at 100 percent sample rate in production.
- Google Places hit 100/100 daily calls on 2 days.
```

## Alerts

Alert channels:

- create GitHub issue
- local terminal output
- optional email/Slack later

Suggested alerts:

- daily provider spend exceeds threshold
- monthly forecast exceeds threshold
- Google Places reaches 80 percent daily quota
- Sentry reaches 80 percent event/transaction quota
- OpenAI or Anthropic local review run exceeds expected token budget
- unknown production API key appears without a matching provider tracker

## Security And Privacy

Rules:

- never store raw API keys
- use read-only billing credentials
- separate application runtime secrets from billing-reader credentials
- do not send cost data to third-party LLMs unless explicitly requested
- avoid user-level spend reports unless needed for abuse/debugging
- store user id only when needed, and never raw email
- redact query text and coordinates from cost events unless required for billing attribution

## Implementation Phases

### Phase 1: Local Ledger And Google Places Estimate

- create cost tables
- add local Google Places usage/cost report using `google_api_usage`
- add provider discovery for known production config keys
- produce `npm run costs -- --days=7`

### Phase 2: Exact Billing Imports

- add AWS Cost Explorer sync
- add Google Billing BigQuery sync
- add Sentry usage/quota sync
- normalize all into `cost_daily`

### Phase 3: AI Provider Tracking

- wrap local review agents with run metadata
- record OpenAI/Anthropic model, tokens, and estimated cost
- reconcile against provider usage APIs where possible

### Phase 4: Alerts And GitHub Issues

- create/update GitHub issues for budget breaches
- close budget issues when costs return below threshold
- add anomaly detection

### Phase 5: Admin Dashboard

- add a private/admin-only cost dashboard
- show trend charts, budget state, provider status, and detected untracked keys

## Open Questions

- Where should the local scheduler run: developer machine, EC2 host, or both?
- Should costs be stored in the production database or a separate local-only SQLite/Postgres database?
- Which currency should be canonical?
- Do we want per-feature attribution, or only provider/service attribution initially?
- What monthly budget should trigger GitHub issues?
- Should Sentry tracing/profiling sample rates be automatically reduced when usage spikes?

## Recommended First Step

Start with a local-only CLI and database-backed ledger:

1. Discover configured providers from production.
2. Read Google Places usage from `google_api_usage`.
3. Estimate Google Maps Platform spend for the current day and previous 14 days.
4. Add Sentry usage/quota sync next, because Sentry is already instrumented and can create noisy spend through traces/profiles.
5. Add AWS and Google exact billing imports once read-only billing credentials are confirmed.
