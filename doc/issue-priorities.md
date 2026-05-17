# Issue Priorities

Generated from the open GitHub issue backlog on 2026-05-17.

## Prioritization Model

Priority is based on:

- Risk reduction: prevents data loss, auth/session surprises, costly API behavior, or broken automation.
- Dependency value: unlocks several later issues.
- User value: improves the travel search experience directly.
- Implementation size: smaller high-value work moves earlier when it unblocks learning.

## P0: Do First

These reduce operational risk or keep the new issue-based maintenance loop trustworthy.

| Issue | Why it is P0 | Suggested next step |
| --- | --- | --- |
| [#25 Make schema initialization non-destructive by default](https://github.com/arjanvandermeer/travel-mcp-server/issues/25) | Prevents accidental data loss and affects setup docs, migrations, and local/prod safety. | Split dev reset from safe bootstrap, then update `README.md` and `GETTING_STARTED.md`. |
| [#30 Add smoke coverage for the maintenance review workflow gate](https://github.com/arjanvandermeer/travel-mcp-server/issues/30) | The weekly review agent now owns issue hygiene; this workflow should be verified quickly. | Add a cheap manual or CI smoke path for `workflow_run` diff and issue permission behavior. |
| [#5 Validate OAuth MCP connector flows and add user preference support](https://github.com/arjanvandermeer/travel-mcp-server/issues/5) | Auth/connectivity is public integration surface. Preferences can wait, but connector validation should not. | Split or sequence this issue: first MCP Inspector and ChatGPT connector validation, then preferences. |
| [#27 Decide and document process-local auth/session state assumptions](https://github.com/arjanvandermeer/travel-mcp-server/issues/27) | Prevents scaling/deployment ambiguity around sessions, PKCE state, and introspection cache. | Document current single-instance assumptions; only externalize state if scaling is actually planned. |

## P1: Core Data Quality And Search Foundations

These improve current product quality and unlock many later features.

| Issue | Why it is P1 | Dependencies / Notes |
| --- | --- | --- |
| [#4 Improve Google Places name matching for Thai, non-Latin, and reordered names](https://github.com/arjanvandermeer/travel-mcp-server/issues/4) | Better enrichment quality improves ratings, photos, opening hours, price, and downstream scoring. | Pair with regression tests for false positives and Thai/transliterated names. |
| [#10 Add cuisine filtering to restaurant search tools](https://github.com/arjanvandermeer/travel-mcp-server/issues/10) | Low effort, high product value; uses existing `cuisine` data. | Good first product issue. |
| [#12 Add dietary restriction filters to restaurant search](https://github.com/arjanvandermeer/travel-mcp-server/issues/12) | High user value and uses existing OSM tags. | Can share filter-mapping patterns with #11, #17, and #18. |
| [#15 Add accommodation type filtering to hotel search](https://github.com/arjanvandermeer/travel-mcp-server/issues/15) | Small, direct hotel-search improvement. | Should be implemented before hotel intent/search scoring features. |
| [#11 Add amenity-aware filtering to hotel search](https://github.com/arjanvandermeer/travel-mcp-server/issues/11) | Unlocks hotel intent, quality scoring, and comparison. | Confirm JSONB indexes/query plan before broad rollout. |
| [#13 Add open-now and open-at filtering for hotels and restaurants](https://github.com/arjanvandermeer/travel-mcp-server/issues/13) | Unlocks late-night search, occasion matching, dining planner, and itinerary timing. | Use a proven opening-hours parser if possible. |

## P2: Product Differentiators

Build these after the core filters are stable.

| Issue | Why it is P2 | Dependencies / Notes |
| --- | --- | --- |
| [#14 Add hotel chain and brand hierarchy search](https://github.com/arjanvandermeer/travel-mcp-server/issues/14) | Strong differentiator for loyalty travelers; schema/seed work is moderate. | Depends on safe schema/migration posture from #25. |
| [#16 Add restaurant price filtering and dining budget estimates](https://github.com/arjanvandermeer/travel-mcp-server/issues/16) | Valuable for budgeting and later dining planner. | Depends on Google Places enrichment quality/coverage from #4. |
| [#17 Add intent-based hotel search](https://github.com/arjanvandermeer/travel-mcp-server/issues/17) | Turns raw filters into natural user workflows. | Depends on #11, #15, and partially #14/#21. |
| [#18 Add restaurant occasion matching](https://github.com/arjanvandermeer/travel-mcp-server/issues/18) | Similar natural-language value for restaurants. | Depends on #10, #12, #13, and #16. |
| [#21 Compute stay quality scores for hotels](https://github.com/arjanvandermeer/travel-mcp-server/issues/21) | Creates a proprietary ranking signal. | Depends on #11, #13, #16, and stronger enrichment quality. |
| [#22 Add neighborhood livability scoring around hotels](https://github.com/arjanvandermeer/travel-mcp-server/issues/22) | Useful standalone and as an input to comparison/planning. | Can reuse nearby POI logic; should precede #19 and #23. |
| [#20 Add food district and restaurant cluster discovery](https://github.com/arjanvandermeer/travel-mcp-server/issues/20) | Unique discovery feature using PostGIS strengths. | Benefits from #10 and #16 for cuisine/price summaries. |

## P3: Decision And Comparison Tools

These are valuable once the underlying signals exist.

| Issue | Why it is P3 | Dependencies / Notes |
| --- | --- | --- |
| [#19 Add hotel comparison tool](https://github.com/arjanvandermeer/travel-mcp-server/issues/19) | Decision-support surface, but needs good signals first. | Depends on #11, #14, #21, and #22. |
| [#23 Add multi-POI itinerary builder](https://github.com/arjanvandermeer/travel-mcp-server/issues/23) | Big end-user feature with more product judgment. | Depends on #13, #20, #22, and stable route/POI scoring. |
| [#24 Add trip dining planner](https://github.com/arjanvandermeer/travel-mcp-server/issues/24) | Potential flagship feature, but depends on several restaurant filters. | Depends on #10, #12, #13, #16, #18, and #20. |

## P4: Platform, Documentation, And UX Polish

Important, but not as urgent as the safety and core search work.

| Issue | Why it is P4 | Dependencies / Notes |
| --- | --- | --- |
| [#26 Remove constructor-time async side effects from TravelDatabase](https://github.com/arjanvandermeer/travel-mcp-server/issues/26) | Improves lifecycle clarity and test noise. | Do before major database-layer extraction if touching startup heavily. |
| [#28 Split broad database and tool contract modules by domain](https://github.com/arjanvandermeer/travel-mcp-server/issues/28) | Long-term maintainability. | Do incrementally as part of nearby feature work, not as a standalone mega-refactor. |
| [#29 Add architecture and canonical request-flow documentation](https://github.com/arjanvandermeer/travel-mcp-server/issues/29) | Helps future contributors and agents. | Best done after #25/#27 decisions are documented. |
| [#8 Publish OpenAPI or Swagger documentation for the HTTP API](https://github.com/arjanvandermeer/travel-mcp-server/issues/8) | Improves API consumption. | Do after search parameter additions to avoid immediate churn. |
| [#6 Build richer MCP Apps UI for interactive maps, filters, and galleries](https://github.com/arjanvandermeer/travel-mcp-server/issues/6) | Good host experience, but benefits from stable filters/data. | Coordinate with frontend redesign #9 if both are active. |
| [#9 Redesign the frontend web experience](https://github.com/arjanvandermeer/travel-mcp-server/issues/9) | Product polish; scope is broad. | Define target user flows first, ideally after P1 search filters land. |
| [#7 Add scheduled data refresh and one-command OSM import workflow](https://github.com/arjanvandermeer/travel-mcp-server/issues/7) | Operational quality-of-life. | Schedule refresh only after quota/cost behavior is fully comfortable. |

## P5: Exploratory / Later

Keep these visible but do not let them distract from core search, enrichment, and operations.

| Issue | Why it is P5 | Suggested next step |
| --- | --- | --- |
| [#31 Add Wikidata enrichment and route-planning capabilities](https://github.com/arjanvandermeer/travel-mcp-server/issues/31) | Broad exploration with licensing/data-source questions. | Split into separate Wikidata enrichment and route-planning issues when one becomes concrete. |
| [#32 Evaluate future travel integrations beyond core POI search](https://github.com/arjanvandermeer/travel-mcp-server/issues/32) | Strategic exploration, not implementation-ready. | Use as a parking lot; create narrower issues only after API access/cost/legal fit is known. |

## Recommended Sequence

1. Stabilize operations: #25, #30, #5 connector validation, #27.
2. Improve enrichment quality: #4.
3. Ship foundational filters: #10, #12, #15, #11, #13.
4. Add differentiators: #14, #16, #17, #18, #21, #22, #20.
5. Build decision/planning tools: #19, #23, #24.
6. Polish platform and UX: #26, #28, #29, #8, #6, #9, #7.
7. Revisit explorations: #31, #32.

## Quick Wins

- #10 cuisine filtering
- #15 accommodation type filtering
- #30 maintenance workflow smoke coverage
- #27 document current session-state assumptions before redesigning anything

## Highest Risk Items

- #25 because destructive schema defaults can damage data.
- #5 because connector auth is an integration contract.
- #13 because opening-hours parsing is deceptively complex.
- #14 because schema/seed changes can create migration and matching drift.
- #24 because it compounds many incomplete restaurant signals.
