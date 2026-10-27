# Counter queue D1 query measurement — 27 October 2026

Scope: Cloudflare plan step 5, D219, branch `codex/cloudflare-d1-query-performance` from main `e2b5380`. Main's staging deployment passed in run `40444162955`. No live customer records or remote database were changed.

## Finding and change

The counter polls every ten seconds. Its queue batch repeats the active-order predicate in three reads: the queue, its lines and its payments. Before database statistics were collected, the old predicate selected `orders_tenant_placed_idx (tenant_id=?)`, reading a cafe's finished history to find a few active orders. A status rewrite alone and a full tenant/branch/status index did not reliably remove that plan for the ordered queue read.

Migration `0049_orders_active_queue` adds the partial index `orders_active_queue_idx (tenant_id, branch_id, placed_at, id)` for `awaiting_payment`, `preparing` and `ready` only. The shared queue predicate names that fixed status set literally, then keeps awaiting-payment rows only while their deadline is strictly later than now. Fixed literals are required here so SQLite can prove that the query implies the index predicate; bound status values did not select this partial index in the regression test. Tenant, branch and time remain bound values.

This is an index over current database rows, not a cache. Each poll still reads a fresh batch, and completion or cancellation removes the order from the partial index during the same status update. Expired unpaid rows remain in the index until the existing expiry task changes their status, but the query excludes them immediately at the deadline. Preparing/ready orders from an earlier business date remain visible. The finished-today count, payment commands, authorization and polling interval are unchanged.

## Local D1 evidence

Reproduction: `corepack pnpm vitest run --project server server/features/orders/tests/counter-d1-performance.test.ts`.

The test uses workerd's local D1 through Wrangler 4.141.0, Drizzle 0.45.3 and all checked-in migrations. It seeds 2,000 completed orders, the five statuses in the target branch, and a second cafe. Three orders remain active. It captures the production repository's batch SQL; the baseline restores the old equivalent predicate and removes the new index only in this disposable database. The baseline and new queries return identical raw results; the final queue snapshot also matches after index removal. These are local D1 `meta.rows_read` observations, not production network latency or billing totals.

| Read | Before, no ANALYZE | After, no ANALYZE | Before, after ANALYZE | After, after ANALYZE |
|---|---:|---:|---:|---:|
| Queue with names | 2,013 | 8 | 14 | 10 |
| Active order lines | 2,009 | 7 | 11 | 7 |
| Active payments | 2,009 | 7 | 11 | 7 |

The fixture's line/payment tables are empty; existing counter tests separately cover populated lines, payment mapping and status transitions. The partial index's plan is checked for all three active reads before and after ANALYZE in SQLite and workerd. Statistics already let the old query use a cheaper plan in this fixture; do not present the cold-plan reduction as a universal percentage speedup. Larger active queues still cost more, and the independent finished-today count still scales with that day's records.

## Cost, rollout and rollback

The index adds storage and write maintenance for active orders and transitions out of that set. Creation reads existing orders and writes qualifying index entries; the migration should run once, before the new Worker. No existing index is dropped, no order row is rewritten, and the old Worker remains compatible during rollout. The migration is generated from the schema and its SQL was inspected. Existing deployment jobs already apply migrations before deploying the Worker.

Use the existing Workers Paid/D1 setup; no subscription, service, database replication or data cache is added. There is no promise of a fixed monthly bill or an end-to-end latency improvement from this fixture.

Revert the repository predicate to roll back application behavior; the additive index can remain safely. Remove it later only with a forward migration that also removes its schema declaration. Never edit an already-deployed migration.

After merge, confirm the staging migration/deploy and read plan, then compare route latency and D1 reads under representative counter traffic. Production remains behind its existing manual reviewer gate.

## Verification status

- SQLite counter tests cover two cafes/branches, lines/payments, status changes, rate freshness, exact payment-deadline boundaries, old active orders, stable ordering and the queue index plan.
- Removing the index, replacing the fixed status term with bound values, and removing the active predicate's tenant scope each failed an assertion in the SQLite counter suite; all mutations were restored and both counter suites passed again (six cases). An initial comment-only mutation failed migration setup rather than an assertion; the repeated index mutation used `SELECT 1` and failed the plan assertion as intended.
- Local browser checks are blocked: Chrome is absent and Playwright's download returned a truncated archive. Keep the PR draft until the full CI browser suite passes.
- Final lint, types, audit, unit/server, environment builds and dry-run evidence is recorded in [progress](../progress.md#cloudflare-d1-counter-queue-d219-2026-10-27).

## References

- [Cloudflare: indexes and query plans](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
- [SQLite: partial-index query implication and exact term matching](https://www.sqlite.org/partialindex.html)
- [Drizzle: indexes and constraints](https://orm.drizzle.team/docs/indexes-constraints)
- Installed `drizzle-orm/sqlite-core/indexes.d.ts`: `IndexBuilder.where(condition: SQL)`; generated migration and local D1 verify the SQLite dialect.
