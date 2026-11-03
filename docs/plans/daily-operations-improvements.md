# Daily cafe operations — decision brief, 2026-11-03

Scope: source reviewed on main at `82cbe189523950df5fd4f318711b5524c4fee969`. This is product/implementation planning, not approval to change inventory, refunds, permissions or accounting. No cafe interviews, service-time measurements or production usage data were available; missing functionality is not proof that every cafe needs it.

## Recommendation

Finish backup recovery verification and approve the KHQR exception workflow first. For daily operations, validate walk-in demand with one cafe; preparation-age visibility is the lowest-risk next UI slice. Quantity inventory and true drawer reconciliation require product decisions and new financial/stock data. Avoid broad POS features before those foundations.

| Rank | Candidate | Current implementation | Smallest useful version | Decision now |
|---|---|---|---|---|
| 1 | Fast assisted walk-in order | Counter manages existing orders; no counter order-creation POST or cart. Customer/guest ordering already works. | Staff cart using existing menu/quote validation; create an attributed walk-in order, then existing payment step. | Validate demand and approve customer attribution/permissions before implementation. |
| 2 | Preparation visibility | Cards show time since placed; server has paidAt/readyAt/completedAt. | Show preparing duration from paidAt and ready waiting time from readyAt. | Worth a focused UI slice after payment reliability; no invented delivery promise or automatic action. |
| 3 | Corrections/exceptions | Whole-order cancellation and full owner refund already exist; no line edits/partial refund. | Make existing safe cancellation/refund paths easier to find; durable payment cases from the separate audit. | Prioritize recoverability; defer paid-line editing and partial refunds. |
| 4 | Optional unit stock | Manual per-branch variation sold-out toggle, availability rules, commit-time checkout validation. | Optional branch/variation unit counter with explicit reservation/release rules. | Defer until a cafe confirms finite-unit overselling and approves rules. |
| 5 | Closing/reconciliation | Daily reports and method/return records; no drawer sessions/tender ledger. | Read-only end-of-day checklist/report first; real reconciliation only after tender recording. | Defer accounting writes. Do not label converted sales as actual drawer cash. |

## 1. Assisted walk-in ordering

**Problem:** a customer without a phone, data or willingness to self-order must still buy quickly. Requiring the cashier to use their personal customer session creates attribution/self-payment problems.

**What exists:** customer ordering supports guest identity and normal quote/checkout. Counter home selects a branch, opens queue/sold-out/finished views and handles collection. In the current counter API tree, `orders/index.get.ts` lists orders; no collection POST creates one. The service rejects manually paying one's own customer order. Do not bypass that protection by treating the cashier as the customer.

**Established approach:** Square's restaurant check view keeps item configuration beside a running cart, with compact screens using a focused view. Use that interaction pattern, not its advanced bulk/seat/course features. [Square check view](https://squareup.com/help/us/en/article/8633-set-up-and-manage-real-time-check-view-for-restaurants).

**Proposed first version:** choose items/options/add-ons, optional customer display name, pickup or an existing active table, review total, create unpaid order, then use current Take payment. Preserve pay-before-preparing. Keep one order id across a lost response; never create a second cart/order automatically after a timeout.

**Approval questions:** staff permission for order creation; anonymous walk-in attribution without a fake shared personal account; whether optional names are acceptable; dine-in/table rules; whether staff may use their own benefits on an assisted sale (recommend defer benefits in version one, but this is not an approved rule).

**Integrity/security:** branch membership and cafe scope on every request; server prices/availability; same D257 checkout commit guards and unpaid constraints; idempotency spanning order creation; immutable sale attribution separate from customer identity. Tenant switch/logout clears the draft. No offline ordering promise.

**Edge cases/tests:** sold out or price changes during cart; branch pause/close/table archival; two tabs; repeated Create/lost response; name containing Khmer; staff revocation; stale selected branch; rejected or unavailable payment after order creation. Phone uses a sticky summary, tablet uses cart beside item grid; all actions remain accessible with Nuxt UI controls.

**Validation before build:** observe ten walk-ins at a cafe: who enters orders, time to payment, errors and requests for a printed receipt. A customer-menu shortcut alone is acceptable only if the identity/own-payment journey is intentionally supported.

## 2. Optional unit stock

**Problem:** a cafe has three pastries or one bottled drink left, and multiple customers order them. A boolean sold-out switch cannot represent the last unit.

**What exists:** `branch_item_states` tracks soldOut per branch and menu variation, with who/when. Checkout now rejects changes to availability between reading and committing. Order-line quantity is purchase quantity, not inventory. No remaining-unit invariant currently exists.

**Established approach:** Toast distinguishes in-stock/out-of-stock from a quantity count and marks a zero-count item out of stock. Its documentation also shows that decrement timing can depend on when an order is sent/paid; that choice cannot simply be copied into NUK Cafe's unpaid-order flow. [Stock status/count](https://doc.toasttab.com/doc/platformguide/adminSettingInventoryStatusForMenuItems.html), [count timing](https://support.toasttab.com/en/article/Setting-a-Count-on-Menu-Items-for-Toast-Online-Ordering).

**Small first version, after approval:** opt-in tracking by branch/variation; integer available quantity; audited stock adjustments; quantity guard and movement in the same checkout/payment transaction as the approved stock event. Keep ordinary drinks untracked. No ingredient recipes, procurement, multi-warehouse or forecast system.

| Rule needing approval | Tradeoff |
|---|---|
| Reserve on unpaid placement or decrement only on payment? | Placement prevents promising the same last unit, but holds stock during the 30-minute unpaid window. Payment avoids holds, but unpaid orders may later lack stock. |
| Hold duration and release event? | Expiry, customer/staff cancel and failed placement must release exactly once if reservations are chosen. No automatic nightly reset without a rule. |
| Does a cancellation/refund restock? | Prepared/wasted drinks differ from unopened goods. A refund does not inherently mean inventory returned. |
| Who adjusts count / may override shortage? | New permission and audit policy. Recommend no negative quantity and explicit adjustment reasons. |
| Manual sold-out override precedence? | Decide how untracked, manual sold-out, count zero and scheduled availability compose. |
| Unit granularity? | Agree variation-level units and shared stock for sizes/add-ons; defer shared ingredients in version one. |

**Integrity/tests:** atomic conditional decrement/reservation, nonnegative database constraint, unique movement key, tenant/branch relationships, no deleting movements. Two migrated-database orders for the last unit: exactly one succeeds under the approved event; cancellation/retry/release races cannot mint units. Test tracking toggles, quantity changes, stale edits, failed batch rollback, expiry backlog, day boundaries and restoration after a database interruption.

**Worth now?** Only if a real cafe sells limited units and accepts the hold/decrement policy. Keep the existing sold-out workflow meanwhile.

## 3. Corrections and exceptions

**Problem:** a mistaken modifier, unavailable item or wrong payment needs a traceable resolution without erasing what was ordered/paid.

**What exists:** staff cancel unpaid/preparing orders with a reason; preparing cancellation records a manual return method. Ready/completed orders use owner full refund within 30 days. History/audit remain; completed refund keeps completion time. Extra KHQR receipts are a separate unresolved obligation, not a normal refund of the original sale. There is no general line-edit or partial-refund endpoint.

**Established approach:** Square separates voiding an unprepared mistake from comping an already prepared item and records reasons. This supports separate actions rather than an unrestricted Edit order button. [Comp/void documentation](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void).

**First version:** surface existing cancellation/refund/history clearly and use the proposed durable payment case list. If demand supports unpaid correction, propose cancel-and-reorder with a visible relationship, not rewriting the existing order. A linked replacement order needs its own approved attribution/permission/stock policy.

**Unapproved rules:** paid item changes, partial refunds, goodwill discounts, remake cost/stock treatment, who can do each action, loyalty/voucher reversals and actual cash/KHQR returned amounts. Do not add a second payment or edit the captured price to balance a correction.

**Integrity/tests:** immutable originals, append-only correction/refund events, version/idempotency and authorization guards in one batch; cancellation versus payment/ready; refund versus second refund/complete; two cafes; input limits/reasons; lost responses. Bank refund happens outside this app; staff recording it is not proof that the bank actually executed it.

**Worth now?** Existing full paths cover much of the need. Durable KHQR exceptions have a clearer confirmed integrity gap than a broad order editor.

## 4. Closing and cash reconciliation

**Problem:** the owner needs to know whether money collected matches the cash physically left at handover.

**What exists:** Summary/Sales/Order history reports, payment methods, KHR cash rate/amount snapshots and return methods. No explicit drawer, opening float, cash paid-in/out, counted-close or shift lock. The business day begins at 04:00 Asia/Phnom_Penh; it is not necessarily one person's shift.

**Critical data limitation:** the payment form's received/change values do not persist. A cash return records method cash without physical currency denominations. Mixed USD/KHR change can make the physical drawer differ from sales converted using one rate. Current reports cannot establish an exact drawer balance by currency.

**Established approach:** Square sessions distinguish starting cash, sales/refunds, paid-in/out, expected cash and counted cash; a session is tied to a drawer/device context rather than assuming one calendar report equals one shift. [Square cash drawer sessions](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session), [Cash Drawers API](https://developer.squareup.com/reference/square/cash-drawers).

**First version:** read-only close checklist showing still-open orders, method-separated recorded collections/returns and unresolved payment cases. Label it sales/collection review, not an exact drawer reconciliation or bank settlement report. Persisted sign-off/counts are a later permission/accounting decision.

**Approval before real reconciliation:** drawer identity versus shared device; shift ownership/handover; opening float by physical currency; cross-currency change; cash-in/out reasons; refund tender currencies; counted balance and variance handling; whether close locks entries and how later corrections work; midnight/04:00 boundaries. Never mutate exchange-rate history or invent a balancing payment.

**Integrity/tests:** one open session per approved drawer scope; atomic cash movement attribution; append-only corrections; exact integer minor units per physical currency, no float totals; versioned close and duplicate-close replay. Race collection/refund versus close, multi-device handover, resumed sessions, late returns, backdated records and two-tenant isolation. UI must clearly separate KHQR bank receipts from cash.

**Worth now?** Closing visibility can be useful; trustworthy physical reconciliation requires tender data first. Do not build a finance dashboard over missing evidence.

## 5. Preparation time and overdue visibility

**Problem:** orders waiting a long time can be overlooked; time since placement includes unpaid waiting and is a misleading preparation timer.

**What exists:** order timestamps and cards displaying time since placed; preparing/ready columns; paidAt/readyAt on the counter response. There is no configured prep target, due time or automatic escalation. Existing sort is oldest placed first; do not silently reprioritize.

**Established approach:** kitchen displays use fulfillment timers to expose preparation progress. Toast also has advanced station/item timing; NUK Cafe does not need that system for a simple counter queue. [Toast fulfillment/KDS](https://support.toasttab.com/en/article/Item-and-Order-Fulfillment-on-KDS).

**Smallest version:** Preparing for N min from paidAt; Ready for N min from readyAt. Use server-offset time, existing one-second timer and accessible text. No customer ETA or overdue badge without an approved target. Clock skew is clamped for display, not written to history.

**Optional later rule:** cafe/branch prep target, when a threshold is snapshotted, who edits it, whether age is elapsed or business-open time, and who should see an alert. Owner approves before the UI calls an order overdue. Do not auto-ready, cancel or refund late orders.

**Integrity/tests:** derived display only, existing tenant response; no migration needed for elapsed labels. Test phone/tablet wrapping, long translated names, dark mode, missing timestamps, future server-offset values, same-order updates and elapsed boundaries. Add unit/browser tests for labels and ensure click targets stay large. No new accounting or reservation behavior.

**Worth now?** Best small operations improvement after payment work; no prep-target business rule is necessary for elapsed labels alone.

## Implementation order and evidence gates

1. PR #253 code/CI review, then separately owner-authorized real backup/decryption/isolated D1 restore.
2. Payment audit tests and owner decision on a durable KHQR receipt/exception workflow.
3. Separate focused PR for elapsed preparing/ready labels if prioritized; follow UI foundation/review rules and affected e2e.
4. Validate assisted walk-ins with a cafe, then approve identity/permission policy and implement one cart journey.
5. Stock and physical drawer accounting only after the rule tables above are settled.

For every behavior change: pnpm lint/typecheck/audit/unit plus affected browser suites; actual migrated SQLite and local D1 for concurrent writes; two-cafe isolation and server authorization; guard-removal checks for new critical safeguards. Report simulated bank/browser tests separately from live evidence. No automatically merged PR or deployed feature is authorized by this brief.
