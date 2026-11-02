# Server performance: platform order activity (2026-11-02)

Scope: first focused server optimization only. Checkout, polling, and scheduled jobs remain unchanged.

## Evidence and decision

The platform's cafe list previously grouped all historical order rows for each selected cafe to calculate both the most recent order and the last 30 days' order count. The existing `orders_tenant_placed_idx` index covers `(tenant_id, placed_at)`.

Use a JSON-bound set of requested cafe IDs to drive two indexed scalar subqueries: an indexed date-range count and a latest-order lookup. Preserve the prior service contract: omit cafes with no orders; keep the latest all-time date even when the recent count is zero; maintain tenant isolation. No migration, API contract, or application behavior changes.

An isolated Python SQLite fixture (12 cafes × 6,000 orders, 72,000 rows) returned equal results. Median query times were about 9.09 ms for the original aggregate and 0.12 ms for the alternative in that synthetic fixture. These are **not D1 or production measurements**; the improvement must be verified using the repository's Drizzle SQL and migration-backed database and on staging.

## Verification status

- Source inspection and synthetic SQLite EXPLAIN QUERY PLAN comparison: complete.
- Added regression tests for old-only orders, 30-day boundaries, cross-cafe isolation, duplicates, empty input, and over-100 ID requests.
- **Not run in this execution environment:** pnpm lint, typecheck, unit tests, e2e tests, D1/workerd tests, staging deployment, and real traffic benchmarks. This environment has Node 22, no pnpm, and no direct repository clone/network access. CI must validate before merge.
- Keep this PR in draft until checks and actual Drizzle/D1 plans are inspected.

## Remaining server audit work

1. Measure checkout pricing and catalog's repeated reads under varying cart size.
2. Add critical-job backlog metrics and explicit expiration-task freshness alarms.
3. Measure counter polling rows read and unchanged-refresh response cost.
4. Benchmark report exports against Workers CPU/memory limits.
