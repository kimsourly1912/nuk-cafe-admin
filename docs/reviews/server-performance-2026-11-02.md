# Server performance: platform order activity (2026-11-02)

Scope: first focused server optimization only. Checkout, polling, and scheduled jobs remain unchanged.

## Evidence and decision

The platform's cafe list previously grouped all historical order rows for each selected cafe to calculate both the most recent order and the last 30 days' order count. The existing `orders_tenant_placed_idx` index covers `(tenant_id, placed_at)`.

Use a JSON-bound set of requested cafe IDs to drive indexed scalar subqueries: an indexed date-range count and a latest-order lookup. The latest lookup is repeated for both projection and existence filtering. Build the count with a normal Drizzle select: `db.$count()` on a Drizzle alias emitted the alias as a table name (`FROM "recent_orders"`) and failed at runtime. Preserve the prior service contract: omit cafes with no orders; keep the latest all-time date even when the recent count is zero; maintain tenant isolation. No migration, API contract, or application behavior changes.

An isolated Python SQLite fixture (12 cafes × 6,000 orders, 72,000 rows) returned equal results. Median query times were about 9.09 ms for the original aggregate and 0.12 ms for the alternative in that synthetic fixture. These are **not D1 or production measurements**; the improvement must be verified using the repository's Drizzle SQL and migration-backed database and on staging.

## Verification status (2026-11-02)

- `pnpm lint`: passed.
- `pnpm typecheck`: passed (Nuxt, watchdog and backup projects).
- `pnpm audit --audit-level high`: passed; 15 findings, all low or moderate.
- `pnpm test:unit`: 2,418 passed, 1 skipped. Windows path and line-ending assumptions in two existing test helpers were normalized so the suite also passes on Windows.
- Focused order activity and tenant service tests: 44 passed. Platform activity and platform e2e files: 44 passed.
- Local D1 migration-backed query plan: passed; all three correlated order reads use `orders_tenant_placed_idx`.
- The original PR CI run failed at lint, before typecheck, audit or unit tests; all three e2e shards passed. CI must rerun for the pushed head.
- No staging deployment or production D1 latency/rows-read benchmark was run. The synthetic SQLite timings above are illustrative only.
- Keep this PR in draft until GitHub checks are green and staging performance evidence is reviewed.

## Remaining server audit work

1. Measure checkout pricing and catalog's repeated reads under varying cart size.
2. Add critical-job backlog metrics and explicit expiration-task freshness alarms.
3. Measure counter polling rows read and unchanged-refresh response cost.
4. Benchmark report exports against Workers CPU/memory limits.
