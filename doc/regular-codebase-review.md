# Regular Codebase Review

This prompt is for a scheduled maintenance review of the whole repository. It is broader than PR review: the goal is to keep `TODO.md` current with code health findings, test gaps, approval-needed changes, sprawl, optimizations, and documentation drift.

## Recommended Scheduling

Prefer an event-gated CI/CD workflow over a plain cron schedule.

Recommended trigger model:

- Trigger on pushes to `main`, plus `workflow_dispatch` for manual runs.
- Skip commits made by automation/bots.
- Skip if the push only changes low-signal files such as `TODO.md`, generated files, or this review prompt.
- Run only if the latest dated `## Regular Codebase Review` entry in `TODO.md` is at least 7 days old.
- If the review runs and finds no new actionable items, still add a small dated note so the 7-day gate advances.
- Open a pull request with the `TODO.md` update instead of committing directly to `main`.

Use Codex automation if the desired output is an inbox item plus an updated local `TODO.md`. It can run the prompt directly in the workspace and make a focused documentation-only change.

Use a GitHub Action if the desired output is a GitHub issue or pull request. That is better for team visibility and auditability, but it requires an LLM/API secret, permissions to create issues or PRs, and careful rules to avoid committing directly to `main`.

Recommended starting interval: 7 days since the last actual review run. This means no commits for 3 weeks produces no review, while daily commits produce at most one review per week.

## CI/CD Gate Design

The workflow should have separate gate steps before invoking any AI agent:

1. Detect whether the push contains code-impacting changes.
2. Parse `TODO.md` for the newest dated subsection under `## Regular Codebase Review`.
3. Compare that date to the current UTC date.
4. Run the review only when both gates pass.

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

- `TODO.md`
- `doc/regular-codebase-review.md`
- generated coverage or local data files
- bot-authored review PR commits

If this becomes a GitHub Action, keep the job split into:

- `gate`: cheap shell checks, no LLM/API calls
- `review`: runs only when `gate` says the review is due
- `pull-request`: opens a PR containing the `TODO.md` changes

## Manual Use

Paste the prompt below into Codex from the repository root. Do not run the implementation work it discovers unless explicitly requested.

## Prompt

You are performing a full maintenance review of the `travel-mcp-server` repository.

Your job is to analyze the whole codebase and update `TODO.md` with actionable findings. Do not implement product or code fixes during this run. Only update `TODO.md`. Treat existing user changes as owned by the user; do not revert or overwrite unrelated work.

### Goals

- Find code that needs human approval before changing because it affects architecture, public behavior, auth, deployment, data safety, costs, or operational assumptions.
- Find correctness bugs, edge cases, missing validation, error handling gaps, and concurrency risks.
- Find test coverage gaps, especially missing regression tests for known or newly found bugs.
- Check unit and integration test coverage quality, including measurable coverage output where available.
- Find code sprawl: files or functions becoming too long, modules taking on too many responsibilities, duplicate logic, or unclear ownership boundaries.
- Find possible optimizations in database queries, indexing, caching, API calls, import jobs, frontend request patterns, startup behavior, and test runtime.
- Find documentation drift between code, `README.md`, `GETTING_STARTED.md`, `doc/`, workflow files, and `TODO.md`.
- Find repo hygiene issues such as generated files, local artifacts, stale docs, unused files, inconsistent naming, or old migration assumptions.
- Find dependency vulnerabilities from `npm audit` and add actionable remediation items to `TODO.md`.

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
- Existing documentation and `TODO.md`

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
2. Read `TODO.md` first and avoid duplicating existing open items.
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
10. Update `TODO.md` only after analysis is complete.

### TODO Update Rules

Add or update a section named `## Regular Codebase Review`.

For each review run, add a dated subsection using the current date. Keep it concise and useful. Prefer merging with existing TODO items instead of duplicating them. If no new findings are discovered, add a short dated note saying no new actionable findings were found so the CI/CD 7-day gate has an explicit last-run marker.

Each finding should include:

- priority: high, medium, low
- category: approval needed, correctness, test coverage, code sprawl, performance, security, operations, docs, repo hygiene
- file or area
- concrete issue
- recommended next action
- test coverage needed, when applicable

Use this format:

```md
## Regular Codebase Review

### YYYY-MM-DD

#### Approval Needed
- [ ] **High** `area/file.js`: Decision needed before changing X because it affects Y. Recommended next action: ...

#### Fixes And Risks
- [ ] **High** `area/file.js`: Issue. Recommended next action: ... Test coverage: ...

#### Test Coverage
- [ ] **Medium** `area/file.js`: Missing regression coverage for X. Recommended next action: ...

#### Code Sprawl And Maintainability
- [ ] **Medium** `area/file.js`: File/function has grown too broad. Recommended next action: ...

#### Performance And Operations
- [ ] **Medium** `area/file.js`: Possible optimization. Recommended next action: ...

#### Dependency Audit
- [ ] **High** `package-lock.json`: `npm audit` found high/critical vulnerability in `<package>`. Recommended next action: upgrade to `<fixed-version>` or document why no safe upgrade exists. Test coverage: run `npm test` after dependency change.

#### Documentation And Hygiene
- [ ] **Low** `area/file.js`: Drift or hygiene issue. Recommended next action: ...
```

### Output Requirements

- Update `TODO.md` with findings.
- Do not make source code changes during this scheduled review.
- Do not mark old TODO items complete unless the code clearly proves they are complete.
- Do not remove existing TODO items unless they are exact duplicates of the new consolidated item.
- Keep the review actionable. Avoid vague items like "improve code quality."
- In the final response or inbox item, summarize:
  - whether `TODO.md` was updated
  - commands run and whether they passed
  - `npm audit` result, including count of moderate/high/critical vulnerabilities
  - unit/integration coverage result, including notable weak areas
  - the highest-priority new findings
  - anything skipped because of missing credentials, network, or local services

### Dependency Audit Rules

- Add all high and critical `npm audit` findings to `TODO.md`.
- Add moderate findings when they affect runtime dependencies, security-sensitive tooling, request parsing, auth, database access, or CI/CD.
- Do not add low findings unless they are easy, safe upgrades with no expected behavioral impact.
- Group duplicate advisories by vulnerable package and remediation path instead of adding one TODO item per advisory.
- Include package name, severity, vulnerable range, fixed version or recommended command when available, and whether it is direct or transitive.
- If `npm audit` cannot run because registry/network access is unavailable, add that fact to the review summary, but do not create a vulnerability TODO from incomplete data.
