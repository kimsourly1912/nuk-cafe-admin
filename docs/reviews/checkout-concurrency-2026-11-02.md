# Checkout concurrency and reliability audit — 2026-11-02

Base: `main` at `26b24f7` (unchanged at final verification); branch `codex/checkout-concurrency-audit`; [PR #248](https://github.com/kimsourly1912/nuk-cafe-admin/pull/248). GitHub's open-PR search returned no open PRs at preparation. The retained `claude/checkout-loading-state` and `codex/server-order-activity-indexed-stats` heads were fetched and verified as ancestors of current `main`; the current-state page's older “in review” rows do not establish active PRs. The last merged PR (#247) had a successful CI run (566). Earlier S/N audits and D98/D99/D101/D163/D169/D194/D199 were reviewed before changing checkout.

## Result and scope

**Confirmed:** a staff change could commit after checkout validated the menu but before its order batch. The batch was atomic, but it did not check whether those earlier reads still applied. Atomic means “all these writes happen together”; it does not mean “every earlier check is still true.”

Fixed here: checkout versus availability, prices, promotions, branch settings/pause and dining tables, plus crossing a time boundary. Existing pricing, snapshots, payment commands, error contracts, tenant scope and idempotency rules remain. No migration, dependency, inventory/reservation feature, external queue or application lock.

“Verified” below means a named test exercises that protection; it is bounded evidence, not proof of every possible execution in production. Payment/provider and delivery observations retain the distinctions below.

## Scenario table

| Scenario | Current protection | Finding | Severity | Action |
|---|---|---|---|---|
| Checkout vs sold-out switch | Fresh menu read; previously no commit guard | Confirmed defect, fixed | High | Menu snapshot guard; forced interleaving on SQLite and local D1 |
| Checkout vs item price edit | Reprice and compare expected total; previously an earlier read | Confirmed defect, fixed | High | Guard item aggregate version; reject changed price |
| Checkout vs option/add-on archive or add-on price edit | Fresh active values/groups; previously an earlier read | Confirmed defect, fixed | High | Guard option-set/group versions, including children |
| Checkout vs availability-window edit | Rules evaluated before write | Confirmed defect, fixed | High | Guard availability-rule versions |
| Promotion published, ended or discount edited during checkout | Fresh promotions at branch-local date; order snapshots | Confirmed defect, fixed | High | Guard the promotion set, including newly added records |
| Branch hours edited or orders paused during checkout | Fresh branch read; pause intentionally does not increment version | Confirmed defect, fixed | High | Guard branch version and pause value separately |
| Table archived while placing dine-in order | Token checked before write | Confirmed defect, fixed | High | Guard dining-table versions; refuse, preserve dine-in intent |
| Time reaches last orders, availability end or promotion-date boundary | Request captured its time before reads | Confirmed stale-time defect, fixed | High | Database clock; final batch guard must remain in the validated minute |
| Multiple customers order one available item | Atomic pickup number allocation; manual sold-out flag | Existing protection verified / intentional product limitation | Low | Distinct customers can all order while on sale; no quantity accounting |
| Same checkout key at once or after lost response | Unique tenant/actor/operation/key in order batch | Existing protection verified | High | SQLite barrier and actual local D1 driver; lost-response injection |
| Different checkout keys | Separate intentional actions; atomic unpaid limit | Existing protection verified | Medium | Both allowed below limit; one refused when competing for final unpaid slot |
| Retries after key retention ends | Idempotency keys expire after 24 hours; orders remain | Intentional product limitation | Medium | After cleanup, the same key can create a new action; no lifetime exactly-once claim |
| Retrying after key retention ends | Keys expire after 24 hours; orders remain | Intentional product limitation | Medium | After cleanup the same key can create a new action; no lifetime exactly-once guarantee |
| Two cashiers pay, or payment competes with cancellation | Conditional status/version, unique event version, unique order payment; atomic batch | Existing protection verified | High | Existing counter and tracking tests rerun; no payment changes |
| Expiry competes with payment | Conditional order status/version; event uniqueness | Existing protection verified | High | Existing expiry interleaving tests rerun; no new financial write |
| Repeated KHQR checks | Atomic four-second charge check claim; deterministic payment key; unique order payment | Existing protection verified | High | Existing ten-check and overlapping-answer tests; Bakong is a stub |
| Cash vs confirmed KHQR, or money arrives after cancellation/expiry | One recorded payment; conflicting bank receipt returns `refund_needed` | Protection verified for existing tests; interruption risk needs evidence | High | Prioritized reconciliation follow-up below; no real bank was called |
| Two staff set ready/complete | Conditional status/version + event uniqueness + key | Existing protection verified | High | Existing simultaneous-ready and completion replay tests rerun |
| Concurrent refund/cancellation | State rules separate preparing cancellation from ready/completed refund; version guard; refund checks unreturned payment | Protection verified for tested paths; full competing-command matrix needs evidence | High | Existing refund/payment-return interleaving rerun; extend matrix separately |
| SQL failure halfway through checkout | One atomic D1 batch | Existing protection verified | High | Local D1 trigger aborts at outbox insertion; all counts unchanged; same key succeeds later |
| Worker dies around notification send | Durable outbox, token-fenced claims, recovery after lease expiry | Existing protection verified / intentional at-least-once limitation | Medium | Existing platform tests rerun; Telegram may duplicate after accepting a lost response |
| Overlapping scheduled jobs | Conditional expiry/claims; tenant cursor is progress, not exclusive ownership | Existing protection verified for tested helpers | Medium | Existing expiry/platform/tenant-job tests; no exactly-once cron claim |
| Stale menu/counter screens | Server prices checkout; server enforces versions on commands | Existing protection verified | Medium | Current server validation remains authoritative; browser data is advisory |
| Another cafe or branch changes | Tenant predicates and branch-specific sold-out/settings snapshots | Existing protection verified | High | Local D1 isolation, inaccessible-branch guard and existing tenant suite |
| Rate/deadline/access changes during a payment request | Earlier validation + status/version guard | Potential risk requiring further evidence | High | Separate payment audit; do not infer a defect from separate reads alone |

## Confirmed defects and reproduction

### C1. Menu changes after validation

Invariant: a new order uses an orderable menu state and the total the customer approved. Its receipt keeps that same state's names, add-ons, prices and promotion details.

Reproduce by letting `placeOrder` finish its menu/quote reads, pausing only its idempotency write batch, committing `setSoldOut`, an item/group/option/rule edit, or a promotion write with the real service, then releasing checkout. Original checkout accepts the old data. Tests also change two line prices in opposite directions so the order total is unchanged: a commit-time edit must still invalidate the earlier snapshot.

The old expected-total check was necessary but insufficient: it compared with a price already read. New `captureCheckoutMenuGuard` captures relevant item/set/group versions and cafe category/rule/promotion sets **before** pricing. A parent version covers its children and links by the established aggregate contract. Sold-out state has no parent version, so the snapshot includes its actual branch/variation values. Ordered row sets detect insertion and removal as well as edits, including a new promotion. The write batch compares the same snapshots before inserting the order.

After a rejected batch, fresh validation selects the existing 409 code (`PRICES_CHANGED`, `ORDER_NOT_ORDERABLE`, etc.). Those reads only explain the refusal: they authorize no new write and never silently accept another total.

Evidence: `orders.service.test.ts`'s `checkout state at commit`; `checkout-d1.test.ts` sold-out/price races and rollback counts. The guard-removal run must make their assertions fail.

User-visible change: a checkout overlapping a relevant edit is refused for a fresh review. A successfully placed order and its replay retain their original snapshot.

### C2. Branch, pause and dining-table changes after validation

Invariant: the selected branch still takes online orders and a dine-in QR still names an active table in that branch.

Reproduce with the same write-boundary hook, committing changed hours, a pause or a table archive after validation. Original checkout creates the order anyway. A pause does not bump the branch's settings version (D199), so checking that version alone would miss it.

`captureCheckoutBranchGuard` covers branch version, the actual `pausedUntil` value and the branch's table-version set. Settings versions cover weekly hours; table versions cover archives, labels and QR rotation. The guard is captured before branch/table reads, and compared in the order batch. Failed dine-in checkout never becomes pickup.

Evidence: SQLite hours/pause/table races, local D1 pause race, branch isolation and wrong-cafe snapshot rejection. Changing another branch's sold-out flags or another cafe's settings/catalog/tables does not invalidate this checkout.

User-visible change: affected in-flight checkouts receive the existing conflict errors. The guard conservatively invalidates on any table edit in the selected branch, or category/rule/promotion library edit in the cafe, even where the priced cart would be unchanged; the fallback is `ORDER_NOT_ORDERABLE`. This favors correctness without adding a revision table. Measure before narrowing it.

### C3. Time changes without a database edit

Invariant: a delayed request must not place an order using an earlier minute's opening/availability/promotion rules.

All current time-dependent menu rules use minute windows or branch-local calendar days. Checkout now obtains its initial time from SQLite/D1 and puts a clock guard **last** in its batch. If execution reaches the next minute, that guard aborts the entire batch. This covers last orders, availability windows and local midnight without translating time-zone rules into a second SQL pricing implementation. Replays still skip validation and return the committed order.

Reproduce by giving the existing internal test-time parameter a time one millisecond before the boundary, then holding the write until the database clock has advanced. The explicit test time shifts the logical origin; elapsed time is still measured by the database. With original checkout or with only the clock guard removed, the order succeeds incorrectly. With the guard, no order, line, event, payment, audit, key or outbox row survives. Local D1 repeats this test.

A minute crossing that changes nothing is conservatively refused for review. Future sub-minute selling rules require a narrower validity boundary; this implementation must be revisited if they are introduced. This is a final SQL validation point within the transaction, not a promise about the instant an HTTP response reaches the customer.

## Request and commit trace

1. The POST route resolves the cafe/session (`requireCustomer`), validates the idempotency header and strict Valibot body, then calls `placeOrder`. No tenant comes from the body.
2. `withIdempotency` hashes the validated request and looks for a prior tenant/actor/operation/key. A replay returns the stored order ID without repricing it.
3. A new checkout reads database time and captures menu/branch snapshots before its business reads. `getPublicMenu` loads the branch/hours, twelve catalog relations in one read batch, branch sold-out state and running promotions. `quoteOrder` checks choices, availability, branch ordering and total. Table resolution checks tenant, branch, active state and token.
4. One atomic write batch inserts the key, validates captured snapshots, writes the guest name where applicable, order/lines/event, unpaid-limit guard and outbox event, then checks the clock. Any error rolls everything back. Pickup numbers still use `max + 1` inside the insert with a unique index.
5. The route reads back the stored order, answers 201 (200 on replay), and schedules immediate notification delivery; the durable outbox supports recovery. Notification success is not a condition of placing the order.

## Verification and limits

**Completed:** lint, typecheck and dependency high-severity gate passed (3 low / 12 moderate). Full unit/server: **2446 passed, 1 skipped, 165 files**. Full local E2E: **813 passed, 63 files**, exit 0, with one Chromium worker and unchanged tests/timeouts. [CI run 568](https://github.com/kimsourly1912/nuk-cafe-admin/actions/runs/41505733490) passed the check job and all three E2E shards on implementation head `51343b3`; deployments were skipped. The final verification-note update changes only documentation and starts fresh PR checks.

The first full E2E attempts with 3/2 workers were interrupted (exit 130/143) after UI timeouts and observed OOM kills in this 2-CPU/8-GiB workspace (97 → 103 → 119). These are not completed suite results. Failure captures were inspected and retained. The complete one-worker run passed, although retained old tabs still caused OOM kills (119 → 186). The test-infrastructure follow-up below records the installed tool's page lifecycle. Regressions are preserved in test-only commit `47c0055` preceding the fix. Against original `main` checkout: **14 assertion failures, 20 cases passed**. Restored guards pass the targeted suite. Independent mutation results (each restored afterward):

| Temporarily disabled | Regression result |
|---|---|
| Menu guard only | 10 failed, 5 passed, 19 skipped in the targeted SQLite suite |
| Branch guard only | 3 failed, 12 passed, 19 skipped |
| Clock guard only | Its boundary regression failed |
| Menu snapshot tenant predicate | Local D1 isolation regression failed |
| Branch snapshot tenant predicate | Local D1 wrong-cafe snapshot regression failed |

All failures above were test assertions, not import/type/SQL construction errors. The original add-on/pause fixtures were corrected before the full original-checkout comparison; the preserved test commit contains those corrections.

- SQLite tests use the checked-in migrations, real feature services, foreign keys and the harness's D1 parameter limits. Only the scheduling hook is simulated.
- Local D1 uses Wrangler's `getPlatformProxy`, actual workerd, all checked-in migrations and Drizzle's D1 adapter. This tests real local transaction rollback and adapter/SQLite behavior. It is not a deployed Cloudflare load or replica/failover test.
- Payment/notification tests use real local database writes with fake external providers. They do not establish Bakong settlement, refunds or Telegram exactly-once delivery.
- E2e uses the built Nuxt app. Customer/API tests reach its seeded SQLite database; many staff UI tests mock HTTP responses. Neither replaces the forced database races.

## Prioritized follow-ups and owner decisions

1. **High: interruption-safe bank reconciliation.** Inspect/reproduce a Worker dying after a confirmed bank receipt and before recording payment or returning `refund_needed`; include cash winning the order, expiry/cancellation, two charge currencies and abandoned counter screens. The current check response reports the conflict, but this review found no durable financial exception record in that path. Define how staff recover and confirm a real refund before implementing a ledger/workflow. This is a potential financial risk, not an observed lost payment or permission to auto-refund.
2. **High: payment validation at commit.** Deterministically test a riel-rate update after `currentRate`, and a manual payment held over its deadline without expiry running; then forced refund/cancel/ready interleavings and access/tenant suspension during in-flight commands. Existing state/version guards are strong but do not themselves establish every rate/time/authorization rule. Reproduce before choosing a fix.
3. **Medium: operational delivery and recovery.** Keep lease-expiry/at-least-once semantics explicit. A provider accepting a send before a response is lost can duplicate notification text. Revisit only if provider idempotency or a product need warrants it. Continue the already-recorded backup/restore work; no backup defect is newly claimed here.
4. **Product decision: numerical stock.** The application tracks a manual per-branch `sold_out` switch. Two customers may both order an on-sale item; there is no “one unit left” invariant to enforce. Stock quantities, reservations, timeout release and replenishment are a separate feature requiring explicit owner decisions, with no implementation in this PR.
5. **Product decision: approval granularity.** The current API approves `expectedTotalMinor`, not a signed per-line quote (D98/D99). This fix rejects any price edit during server validation/commit, including offsetting edits. Separate edits before placement that leave the approved total equal retain the existing aggregate-total contract. Requiring explicit approval of every changed line between browsing and placement needs an API/product decision; it is not silently introduced here.

6. **Medium: browser-test page cleanup.** During this audit, local full-suite runs hit the workspace's 8-GiB limit. Installed `@nuxt/test-utils` 4.3.2 creates a normal page via `browser.newPage`; its `afterEach` clears test context, while `afterAll` closes the browser. Our `setupE2e` closes the extra contexts it tracks, but normal pages accumulate until file teardown. Process inspection showed dozens of retained renderers in the largest file. Three/two-worker attempts were interrupted after observed OOM kills; one worker completed that largest file with its assertions passing, then released the memory. Follow up separately: close each test's normal pages/contexts after failure capture, preserving multi-tab tests and browser-problem evidence. This is test infrastructure evidence, not a production checkout defect.
