# Regular Codebase Review

This prompt is for a scheduled maintenance review of the whole repository. It is broader than PR review: the goal is to keep GitHub issues current with code health findings, test gaps, approval-needed changes, sprawl, optimizations, security issues, and documentation drift.

## Recommended Scheduling

Prefer an event-gated CI/CD workflow over a plain cron schedule.

Recommended trigger model:

- Trigger after successful `CI` runs on `main`, plus `workflow_dispatch` for manual runs.
- Skip commits made by automation/bots.
- Skip if the push only changes low-signal files such as this review prompt or generated files.
- Run only if the latest successful `Codebase Maintenance Review` workflow run is at least 7 days old.
- If the review runs and finds no new actionable items, leave a concise comment on the newest open maintenance issue if one exists, or create a small dated "maintenance review: no new findings" issue and close it. This gives the workflow history an auditable run without changing source files.

Use a GitHub Action for this workflow because the desired output is GitHub issue reconciliation. It requires an LLM/API secret plus `issues: write` permission.

## CI/CD Gate Design

The workflow should have separate gate steps before invoking any AI agent:

1. Detect whether the push contains code-impacting changes.
2. Read the latest successful `Codebase Maintenance Review` workflow run timestamp.
3. Compare that timestamp to the current UTC date.
4. Run the review only when both gates pass, unless `workflow_dispatch` sets `force=true`.

Suggested code-impacting paths:

- `.github/workflows/**`
- `cloudflare-oauth-worker/**`
- `data/**`
- `package.json`
- `package-lock.json`
- `scripts/**`
- `slm/**`
- `src/**`
- `tests/**`
- `web/**`

Suggested low-signal paths to ignore for triggering:

- `doc/regular-codebase-review.md`
- generated coverage or local data files
- bot-authored review commits

## Manual Use

Paste the prompt below into Codex from the repository root. Do not run implementation work discovered by the review unless explicitly requested.

## Prompt

You are performing a full maintenance review of the `travel-mcp-server` repository.

Your job is to analyze the whole codebase and reconcile GitHub issues. Do not implement product or code fixes during this run. Do not edit source files unless explicitly asked. Treat existing user changes as owned by the user; do not revert or overwrite unrelated work.

### Required GitHub Issue Workflow

Use GitHub issues as the source of truth for maintenance findings.

1. Read `.maintenance/github-issues.json` when it exists. It contains the current issue snapshot captured before the review.
2. If the file is missing or stale, run:

```bash
gh issue list --state all --limit 200 --json number,title,state,labels,body,url,updatedAt,closedAt
```

3. For every existing open issue that looks maintenance-related, determine whether it is still relevant.
4. If an open issue is no longer relevant because the code clearly fixed it, close it with a short evidence-based comment:

```bash
gh issue close <number> --reason completed --comment "Closed by scheduled maintenance review: <specific evidence>."
```

5. If an open issue is partially fixed, leave a short comment explaining what remains instead of closing it.
6. Before creating a new issue, search existing open and closed issues by title and body. Do not create duplicates.
7. Create new issues for new actionable findings:

```bash
gh issue create --title "<clear actionable title>" --body "<markdown body>"
```

8. New issue bodies must include:
   - category: approval needed, correctness, test coverage, code sprawl, performance, security, operations, docs, repo hygiene, or product
   - priority: high, medium, or low
   - affected files/areas
   - concrete issue
   - recommended next action
   - test coverage needed, when applicable
   - evidence from code, tests, command output, or docs
9. Prefer updating/commenting on existing issues over creating new ones.
10. Do not close feature/backlog issues just because they are old. Close only when code or documentation clearly proves the issue is complete or obsolete.

### Goals

- Find code that needs human approval before changing because it affects architecture, public behavior, auth, deployment, data safety, costs, or operational assumptions.
- Find correctness bugs, edge cases, missing validation, error handling gaps, and concurrency risks.
- Find test coverage gaps, especially missing regression tests for known or newly found bugs.
- Check unit and integration test coverage quality, including measurable coverage output where available.
- Find code sprawl: files or functions becoming too long, modules taking on too many responsibilities, duplicate logic, or unclear ownership boundaries.
- Find possible optimizations in database queries, indexing, caching, API calls, import jobs, frontend request patterns, startup behavior, and test runtime.
- Find documentation drift between code, `README.md`, `doc/getting-started.md`, `doc/`, and workflow files.
- Find repo hygiene issues such as generated files, local artifacts, stale docs, unused files, inconsistent naming, or old migration assumptions.
- Find dependency vulnerabilities from `npm audit` and create or update actionable GitHub issues.

### Scope

Review these areas:

- Runtime entry points: `src/index.js`, `src/index-http.js`
- MCP contract and handlers: `src/tools-config.js`
- Database and enrichment logic: `src/database.js`, `src/google-places.js`
- API routes: `src/api/*.js`, `src/api-router.js`
- Validation, config, telemetry, templates, and shared libs under `src/`
- Import and maintenance scripts under `src/` and `scripts/`
- Schema and migrations under `data/`
- Frontend under `web/`
- OAuth worker under `cloudflare-oauth-worker/`
- Local SLM agent under `slm/`
- Tests under `tests/`
- CI and review workflows under `.github/`
- Existing documentation under `README.md`, `doc/getting-started.md`, and `doc/`
- Current GitHub issues

Exclude generated or dependency-heavy folders unless a repo hygiene issue points to them:

- `node_modules/`
- `coverage/`
- `.git/`
- `.wrangler/`
- downloaded OSM/GeoNames data files

### Project Constraints

- Runtime is Node.js 24+, ESM modules, no TypeScript.
- Tests use Node.js built-in test runner.
- Database is PostgreSQL/PostGIS through `pg`.
- MCP tool definitions belong in `src/tools-config.js`.
- Database access belongs in `src/database.js`.
- Runtime config should use `app_config` unless it is a bootstrap secret.
- The stdio server must not write normal logs to stdout.
- Keep recommendations aligned with existing architecture. Do not recommend new frameworks or broad rewrites unless the existing design is demonstrably blocking progress.

### Review Process

1. Check working tree status and note existing uncommitted files. Do not modify unrelated user work.
2. Read current GitHub issues first and avoid duplicating existing open or recently closed items.
3. Build a repository map with `rg --files`, excluding generated folders.
4. Measure file and module size. Flag candidates that are getting too long or too broad, especially files over roughly 500 lines and files over roughly 900 lines.
5. Compare source modules to tests. Identify missing tests by behavior, not only by filename.
   - Inspect `npm run test:coverage` output when available.
   - Flag important runtime modules, API routes, MCP tool handlers, auth paths, workflow scripts, import jobs, and bug-prone helpers that have weak or missing coverage.
   - Treat a passing test suite as necessary but not sufficient; look for untested branches, edge cases, and public behavior.
6. Review public contracts:
   - MCP tool names, schemas, descriptions, and response shapes
   - REST routes and auth behavior
   - database schema and migrations
   - OAuth worker endpoints
   - frontend API assumptions
7. Review safety and correctness:
   - input validation
   - SQL and command injection
   - auth/session boundaries
   - PII and token logging
   - background jobs and unhandled promises
   - race conditions and stale state
   - destructive operations and migrations
8. Review performance:
   - unbounded result sets
   - N+1 database calls
   - queries likely missing index support
   - unnecessary Google Places calls
   - unbounded in-memory maps
   - import batch sizing
   - frontend request frequency
9. Run dependency and verification checks if feasible:
   - `npm run lint`
   - `npm test`
   - `npm run test:coverage`
   - `npm audit --audit-level=moderate`
   - targeted `rg`/line-count checks
   - When the `.maintenance/` directory exists, read its captured command outputs before rerunning expensive checks
10. Reconcile GitHub issues only after analysis is complete.

### Dependency Audit Rules

- Create or update issues for all high and critical `npm audit` findings.
- Create or update issues for moderate findings when they affect runtime dependencies, security-sensitive tooling, request parsing, auth, database access, or CI/CD.
- Do not create low-severity issues unless they are easy, safe upgrades with no expected behavioral impact.
- Group duplicate advisories by vulnerable package and remediation path instead of creating one issue per advisory.
- Include package name, severity, vulnerable range, fixed version or recommended command when available, and whether it is direct or transitive.
- If `npm audit` cannot run because registry/network access is unavailable, include that fact in the final summary, but do not create a vulnerability issue from incomplete data.

### Output Requirements

- Reconcile GitHub issues: create new issues, close resolved issues, and comment on partially resolved issues where appropriate.
- Do not create local backlog files; GitHub issues are the source of truth.
- Do not make source code changes during this scheduled review.
- Do not close existing issues unless the code clearly proves they are complete or obsolete.
- Keep issues actionable. Avoid vague items like "improve code quality."
- In the final response or workflow log summary, include:
  - number of issues created
  - number of issues closed
  - number of issues commented on
  - commands run and whether they passed
  - `npm audit` result, including count of moderate/high/critical vulnerabilities
  - unit/integration coverage result, including notable weak areas
  - the highest-priority new findings
  - anything skipped because of missing credentials, network, or local services
