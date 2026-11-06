# Operations

The service has two separate safety checks after deployment:

- `/health` answers whether the HTTP process is alive.
- `npm run test:release-smoke` verifies the public homepage, direct POI document, their required JavaScript, OAuth discovery, and a real POI REST response. EC2 uses this second probe before accepting a release.

EC2 runs `npm run db:init` after dependencies are installed and before restarting the service. `data/schema.sql` is the single non-destructive migration source. Request handlers do not create or alter tables, so schema failures occur at deployment time and trigger its normal rollback path instead of appearing during a user request.

Schema initialization uses a five-second lock timeout and a two-minute statement timeout. Existing view columns must retain their names, types, and order; append new fields at the end of `enriched_pois` so `CREATE OR REPLACE VIEW` can upgrade older deployments without dropping the view or its dependants.

## Operational Status

Authenticated administrators can call the MCP `get_operational_status` tool. It is read-only and reports:

- latest completed import by source and import failures in the last seven days;
- current Google Places quota use and mappings due for retry;
- homepage-harvest outcomes by status; and
- persisted enrichment-task outcomes grouped by kind and status.

`needs_attention` is non-empty when there are recent failed imports, due Google enrichment, or exhausted Google quota. Use it before starting manual remediation tasks. The report does not create tables or otherwise change the database, so it is safe to call during an incident.

## Data Freshness

The scheduled refresh units remain the source of truth for regular imports. Investigate when the newest relevant import is missing or unexpectedly old, when `failed_last_7_days` is non-empty, or when Google quota is exhausted. Review the job journal first, then use the existing admin MCP task controls for targeted work rather than rerunning a global import blindly.
