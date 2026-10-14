# Admin and counter query performance — D170

The owner authorized follow-up audit **N4 and N8** on 14 October 2026. Branch `fix/admin-counter-query-performance` starts from merged main `8a47cb3` (D169, PR #116); that revision's CI/staging run completed successfully. [Audit](../reviews/server-followup-audit-2026-10-14.md).

## Implementation

- **N4:** explicitly scope the admin item price aggregate to the cafe. Use the existing `menu_item_variations_tenant_id_unique` index and preserve sellable price ranges, category ordering, filters, pagination and counts.
- **N8:** one counter context SELECT combines branch timezone, current KHR rate, KHQR capability and a token-presence EXISTS. It never selects the sealed token. Compute the existing 04:00 business date in the service; one four-statement batch then reads active orders, their lines, their payments and the finished count in a consistent queue snapshot.
- Queue statements name tenant and branch; details select through the active-order SQL subquery, without a growing client-side ID list. A 121-order regression demonstrates constant call/statement count and no truncation. Group lines once instead of scanning all lines for each order.
- The route uses **two database calls/five SQL statements** for each fresh poll, replacing eight separate reads for a nonempty queue (including the old route's token lookup). Authorization/session/tenant-resolution work is separate and still runs normally. Empty and large queues remain correct. No cross-request cache, conditional HTTP contract, migration or UI change is introduced; response fields remain compatible.
- **D1 mapping correction discovered during validation:** joined SQL columns must have distinct output names in batches. Alias branch/customer names and catalog add-on override/default min/max columns. A local workerd/D1 probe exposed collapsed names and shifted fields that libsql's array results did not reproduce. The catalog aliases repair D169's existing batch mapping; they preserve add-on pricing/selection rules, rather than changing product policy.

The context is read before the queue batch because the branch's IANA timezone is needed to determine the business date. Both are fresh on every request. The queue rows/details/count share one batch; this is not a cross-request or whole-request cache/snapshot claim. Tie order uses placement time then order ID.

## Acceptance and validation

Verify current prices/disabled variants, two cafes, stable pagination and an indexed inner price aggregate. Verify tenant/branch isolation, payment/status freshness, deadline expiry without a write, local 04:00 business-day rollover, future exchange rates, KHQR enablement and token add/remove, large queues and ordered lines. Read both populated and empty results through the actual Drizzle D1 adapter.

Check safeguards by removing inner price scope, counter context/queue tenant scope, the deadline predicate, batching and both pairs of duplicate SQL aliases; restore after expected test failures. Run lint, typecheck, full unit/server tests, browser/HTTP checks and the Worker build. Because the necessary catalog mapping repair affects shared checkout data, run the full browser suite too. Actual results and preparation pitfalls are recorded in [progress](../progress.md#admin-and-counter-query-performance-d170-2026-10-14).

Other N findings remain recommendations. Changes to manual self-payment, notifications, search semantics, retention, providers, cache policy, external configuration, merge and deployment are outside this implementation.
