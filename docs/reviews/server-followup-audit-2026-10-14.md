# Server review after D169 — 14 October 2026

> Implementation follow-up: the owner authorized N4/N8 on `fix/admin-counter-query-performance`, based on merged main `8a47cb3`. See [D170](../plans/admin-counter-query-performance.md) and [verification](../progress.md#admin-and-counter-query-performance-d170-2026-10-14). Findings below describe the original reviewed `f2bce8e` source. A D1 result-column mapping defect found while implementing those fixes is also addressed in D170.

Reviewed `f2bce8e7ece9bb9169535258ea92647e0295820f` on `fix/server-performance-security`, including the fixes in [PR #116](https://github.com/kimsourly1912/nuk-cafe-admin/pull/116). The owner requested another server query, security and reliability review. This report records findings; it does not implement them or change PR #116. Source, generated SQL, migration-backed service tests and a local workerd/D1 simulator were inspected. No production account, query metrics, load test, provider transaction, merge or deployment was performed.

The earlier [S2/S3/S4/S7/S8 findings](server-audit-2026-10-14.md) are addressed in D169. N1–N9 below are additional findings or scaling follow-ups. P1 means address before relying on the affected security rule; P2 means the next server improvement work. Evidence distinguishes reproduced behavior from a scaling risk.

| ID | Priority / evidence | Improvement and app benefit |
|---|---|---|
| N1 | P1 / reproduced policy gap | Prevent manual self-payment; staff cannot approve their own purchases |
| N2 | P2 / local D1 reproduced | Make substring searches compatible with D1; accepted long/Khmer searches stop causing server errors |
| N3 | P2 / two races reproduced | Make customer ready alerts durable and claimed; recover a failed catch-up send and prevent concurrent duplicates |
| N4 | P2 / query plans reproduced | Scope admin item price aggregation; one cafe's page stops scanning every cafe's variations |
| N5 | P2 / query plans reproduced | Start staff lists from cafe membership; avoid checking every platform user |
| N6 | P2 / SQL captured | Look up the named cafe for ready messages; stop enumerating every cafe for one customer |
| N7 | P2 at large destination counts / reproduced | Bound notification ID lists; alerts still queue when chats exceed D1 bind limits |
| N8 | P2 / local read count; scaling impact unmeasured | Reduce unchanged counter polling work; lower repeated reads and serialization |
| N9 | P2 with accumulated links / source-confirmed backlog risk | Move global connection-link cleanup out of requests and bound it; avoid cleanup latency spikes |

## N1. An authorized cashier can manually pay their own order

[Security's identity rule](../server/security.md#identity) explicitly prohibits staff from completing their own order payment. [payOrder](../../server/features/orders/counter.service.ts#L174) checks status, deadline, exchange rate and QR ownership, but does not check the order customer against the actor. Its shared command's ownership predicate checks branch ownership only.

A probe created two cafes, made a real staff membership and authorized it through `authorizeBranch(..., { payment: ['collect'] })`. The order's customer was that staff account. `payOrder(..., { version: 1, method: 'cash_usd' }, ...)` succeeded, moved it to `preparing`, and wrote a payment with `collectedBy === customerId`.

Enforce the documented restriction on manual collection, preserve the atomic status/version/idempotency/audit batch, and cover all manual methods and two cafes. Separately decide how attribution works for a payment independently verified by Bakong: money that actually arrived must remain recorded. This audit does not infer a new rule for automatic settlement or silently change business policy. No real fraudulent transaction was observed.

Acceptance: a manual self-payment is refused without payment, status, event or audit changes; another authorized cashier can pay; retries and provider-confirmed arrivals remain correct. Removing the new guard must fail its regression.

## N2. Valid searches exceed D1's LIKE limit

The menu item, staff and platform cafe list contracts accept up to 100 search characters. Their repositories turn the search into an escaped `%...%` `LIKE` pattern: [items](../../server/features/menu/items.repository.ts#L93), [staff](../../server/features/identity/staff.repository.ts#L107), [cafes](../../server/features/tenants/tenants.repository.ts#L43).

[Cloudflare's D1 limits](https://developers.cloudflare.com/d1/platform/limits/) specify a **50-byte** maximum LIKE/GLOB pattern. Both wrapper `%` characters, UTF-8 bytes and backslash escapes consume that budget. Accepted examples:

| Search | Final pattern bytes |
|---|---|
| 49 ASCII letters | 51 |
| 17 Khmer characters `ក` | 53 |
| 25 literal `%` characters, escaped | 52 |

The local workerd/D1 simulator accepted 50-byte ASCII and Khmer controls, and rejected the 51/53-byte patterns with `D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR`. Migration-backed libsql service tests accept these searches; their D1 emulation currently enforces bind count only, so ordinary tests miss this platform difference. No deployed request was sent.

Preserve literal substring and existing case behavior with a D1-compatible expression, or validate the final escaped UTF-8 byte size and return a useful field error. Merely changing a character limit to 48 is insufficient for Khmer and escaped input. A parameter-bound `instr(lower(column), lower(search))` is a candidate to evaluate against the current search semantics; it is not an index optimization for arbitrary substring search.

Acceptance: boundary ASCII/Khmer/wildcard searches give the intended result or a typed validation error, never an unexpected 500; verify against local D1, not just libsql. Include platform cafe search as well as tenant menus/staff.

## N3. Customer ready alerts bypass durable delivery in the subscription catch-up path

[sendOrderReadyAlert](../../server/features/notifications/notifications.customers.ts#L116) reads `chatId`/`notifiedAt`, sends, then marks completion, with no delivery claim. [useOrderReadyCode](../../server/features/notifications/notifications.customers.ts#L77) also calls it directly if the order became ready while the customer subscribed. The normal outbox event has a claim, but this additional sender does not share it.

Two probes reproduced:

1. Hold the first sender after it reads the subscription and begins sending. A second sender reads the same state and sends successfully. Release the first: both report success, with two provider calls. This can occur between the subscription catch-up and the claimed ready event, without a lost provider response.
2. The order becomes ready between the subscription's check and commit. The actual ready command writes its outbox event; the actual dispatcher handles it before a chat is stored and marks it sent. Subscription then commits, consumes its one-time code, acknowledges the subscription and attempts the catch-up message. A transient provider failure throws. Repeating the code finds nothing; the ready event is already sent, while `chatId` remains set and `notifiedAt` remains null. No pending event remains to retry that catch-up delivery.

Queue a durable per-order/per-subscription delivery shared by both paths, use a dedupe key and atomic claim, and fence completion with the current subscription/claim. Ensure enqueueing and the subscription transition cannot leave a lost-work gap. Preserve blocked-chat handling and privacy cleanup. Telegram's missing provider idempotency still means a lost answer after acceptance can duplicate an at-least-once send; an application claim only removes avoidable concurrent duplicates.

Acceptance: both races, transient failures, expired claims, repeated codes, a replaced subscription and cross-cafe isolation. A failed catch-up progresses through the scheduled recovery path without making the customer generate a new code.

## N4. The admin item page aggregates every cafe's variations

[listItems](../../server/features/menu/items.repository.ts#L96) builds a `prices` subquery over all sellable `menu_item_variations`, grouping by item. The outer menu item query names the cafe; the inner aggregate does not. Returning 20 products can still price every product on the platform.

Migration-backed `EXPLAIN QUERY PLAN` shows `MATERIALIZE prices` and `SCAN menu_item_variations USING INDEX menu_item_variations_combination_idx`. A probe adding the cafe predicate to that inner aggregate changes it to `SEARCH menu_item_variations USING INDEX menu_item_variations_tenant_id_unique (tenant_id=?)`, using the existing index. This proves avoided global work, not tenant-data disclosure or a measured production latency improvement.

Add the inner cafe scope first. If measurements justify more, select the requested item page before computing its ranges, preserving category/name sorting and pagination. Do not add speculative indexes before inspecting the final plan.

Acceptance: same visible rows/counts/min/max prices and archived-value behavior in two cafes; scoped inner SQL/plan; representative multi-cafe rows-read/latency comparison.

## N5. Staff lists scan all platform users

[listStaff](../../server/features/identity/staff.repository.ts#L104) starts from `user` and tests membership through correlated `EXISTS`, for both the page and count. `EXPLAIN QUERY PLAN` shows `SCAN user`, a per-user membership lookup, and a temporary sort. That user table contains customers and retained guests from every cafe, so a five-person cafe's staff page can become more expensive as unrelated customers sign up.

A probe adding a tenant-member ID subquery changes the plan to indexed user lookups and removes `SCAN user`, using existing indexes. Start from a tenant-scoped membership set or an equivalent semi-join, then apply user search/branch/role filters. Preserve one row per person; an ordinary join must not multiply a person with several branch memberships or duplicate membership data.

Acceptance: current search/role/branch/count/pagination behavior and two-cafe isolation, with a representative platform user fixture and no global user scan. Compare the count query as well as the page.

## N6. One customer ready message reads all cafes

Both code redemption and [ready delivery](../../server/features/notifications/notifications.customers.ts#L119) call `activeTenants()` and find the named cafe in JavaScript. [findActiveTenants](../../server/features/identity/identity.repository.ts#L36) selects all organization rows, sorts and filters activity in JavaScript. The overlap probe captured two organization queries without a WHERE clause for two messages about the same cafe.

Replace enumeration with a lookup for the known tenant ID that also preserves the active/suspended rule. The existing public `tenantById` lookup returns identity without checking status, so substituting it without a status check would change behavior. Cafe identity can be read in the alert query or through an explicit active-tenant helper.

Benefit: a message's database/CPU cost stays tied to its cafe rather than platform cafe count. This is unnecessary global enumeration, not proven disclosure to the customer. Acceptance: active cafe sends; suspended/missing cafe retains the current suppression behavior; two-cafe results remain correct.

## N7. Notification ID lists still exceed D1's parameter limit

[deliveredTo](../../server/features/notifications/notifications.repository.ts#L231), `deliveryIds`, and the optional `ids` filters in `dueDeliveries` use a single `IN (...)` without `readInChunks` or JSON selection. The platform already has helpers for D1's 100-bind limit, but these paths do not use them. Destination counts have no explicit contract cap.

A migration-backed fixture with 101 connected destinations and enabled new-order rules fails `queueOrderAlert` before queueing, with **102 bound parameters** (101 IDs plus dedupe key). The local test adapter enforces the same documented D1 limit. The threshold for that query is already crossed at 100 IDs; other queries have their own reserved parameters. Large closing-summary target lists have the same dedupe query risk.

Use chunked or one-JSON-parameter selection, bound generation/send batches, and retain delivery deduplication. Page work as needed rather than creating an arbitrary product limit. No real cafe with that many destinations was observed; this is a reproduced threshold failure.

Acceptance: more than 100 destinations/IDs queue and progress correctly; retries, uniqueness and two-cafe scoping remain unchanged; every statement stays within the platform limit.

## N8. Unchanged counter polling repeats the entire queue read

[listCounterQueue](../../server/features/orders/counter.service.ts#L88) rereads orders, rate, branch/timezone, KHQR settings, finished count, lines and payments. In a migration-backed one-order fixture it executed **seven service reads per call**, and two unchanged calls executed 14. This excludes route authorization/session/tenant reads. Details use chunked queries as the queue grows, and `withDetails` filters all lines once per order rather than grouping once.

The [active-order query](../../server/features/orders/orders.repository.ts#L129) has no page limit. The predicate prevents finished orders accumulating here, but a real operational backlog of preparing/ready orders can still grow. Do not silently cap it and hide orders from staff.

First group details once and batch independent reads where useful. Then measure a branch change marker or conditional/delta response that avoids unchanged line/payment work, with explicit invalidation for order changes, refunds, exchange rates, KHQR settings and any queue summary. Authorization must still run on every request; expired unpaid orders are time-dependent even without a write. Realtime subscriptions remain conditional on measured polling cost and deployment needs.

Benefit: fewer repeated reads and less response assembly at busy counters. The seven-read count is confirmed; no production latency reduction, cache hit rate or cost saving is claimed.

## N9. Connecting Telegram still triggers unbounded global cleanup

Creating a staff Telegram link calls [deleteOldLinks](../../server/features/notifications/notifications.repository.ts#L169); creating a marketing link calls the analogous [marketing cleanup](../../server/features/marketing/marketing.repository.ts#L126). Both issue a global expired-link DELETE on the request path, without a batch limit or run budget. The predicates use expiry indexes, and these functions do not materialize DELETE RETURNING results, but an accumulated backlog can still make one cafe's Connect request clean every cafe's old links.

Move cleanup into bounded scheduled maintenance and keep request-time code checks authoritative. Preserve the existing one-day-after-expiry cutoff and marketing's connected-link exclusion; no new retention policy is needed for these already-expired links. This is a source-confirmed backlog/latency risk, not an observed slow production request.

Acceptance: large multi-cafe expired-link fixtures drain over runs; live links and the existing kept marketing records survive; Connect does not depend on deleting the entire backlog.

## Earlier priorities still outstanding

These are not new N findings. Current source still contains the prior audit's remaining issues:

- **S1 — assistant input restrictions:** `checkConversation` validates SDK message shape/user text but still accepts file parts and does not budget all assistant history. The previous real-service SDK download probe established the issue; it was not rerun here. Restrict this text-help product's allowed parts before usage reservation, and bound total model input. P1 if AI is enabled.
- **S5 — KHQR cadence:** ten concurrent local unpaid checks made ten calls to the Bakong stub. Add a per-tenant/charge cadence and cross-isolate coalescing/backoff; module-local promise maps cannot coordinate the platform. Preserve payment freshness and manual fallback.
- **S6 — provider response bounds and shape:** Bakong still parses the whole response body without a byte cap. A new probe returned JSON with an object `toAccountId`; parsing classified it as paid and matching threw `trim is not a function`. No payment was written, but the service failed instead of returning unavailable. Validate strings/numbers/reference lengths and count actual response bytes, including streamed bodies. [Cloudflare recommends bounding consumed payloads and streaming unknown bodies](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
- **S9 — operations:** production monitoring/recipients, capacity/plan, recovery drills and the release gate still require the existing operational work. This review inspected source only and cannot establish deployed readiness. Delivery throughput/backlog fairness needs measurement before adopting queues or database partitioning.

## Evidence and recommended order

Ten temporary probes passed on the reviewed source. They intentionally assert the unwanted current behavior or compare candidate SQL plans; passing does **not** mean the problems are fixed. Probe source was copied to `/tmp/nuk-server-followup-probes.test.ts` and removed from the repository. Results: `/tmp/nuk-server-followup-probes.log`; structured details: `/tmp/nuk-followup-evidence.jsonl`. Initial probe fixture mistakes were corrected before the final passing run.

Local Miniflare/workerd D1 boundary checks: `/tmp/nuk-followup-d1.mjs`, `/tmp/nuk-followup-d1.log`. The simulator runs the project's `2025-07-15` compatibility date, with no remote D1 connection. Initial Miniflare v5 option/date preparation failures are not validation evidence. Current Cloudflare D1 limits and Workers best practices were retrieved with the web connector; the shell docs fetch was denied by network policy. Latest published Workers types `5.20261014.1` were checked against the already-retrieved local package; no dependency was changed.

Seven existing affected server test files also passed, **148 tests**: menu items, staff, counter, KHQR checking, Bakong, customer notifications and delivery. No application code was edited, so no full lint/typecheck/browser/build rerun is claimed for this audit. PR #116's earlier validation remains a separate record.

Recommended next implementation: N1's documented manual-payment guard, N2's D1 search compatibility and N3's durable ready-delivery fix. Address S1 first if enabling AI. Then N4/N5/N6 remove verified unnecessary global reads. N7/N9 and measured N8 can follow without weakening authorization, price freshness, versions, audit or financial retention.
