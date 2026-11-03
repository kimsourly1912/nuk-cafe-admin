# Payment reliability audit — 2026-11-03

Reviewed source: main at `82cbe189523950df5fd4f318711b5524c4fee969`. This continues the payment follow-ups from the [checkout audit](checkout-concurrency-2026-11-02.md). Backup repair remains independently tracked in PR #253.

## Outcome

The existing payment commands already protect the order from duplicate local payments with tenant-scoped reads, status/version guards, one atomic batch, a unique payment per order, idempotency, events and audit. Those safeguards should be retained.

**Highest priority gap:** a bank receipt that cannot become the order's payment is returned as `refund_needed`, but no durable exception or recovery task is written. Closing the payment panel stops bank polling. A successful bank lookup followed by a Worker/database failure can recover when someone checks again; there is no independent guarantee that someone will. This is a confirmed code-path gap, not evidence that a real customer's money has been lost.

This change adds database-backed tests and implementation planning only. No new payment/accounting rules, charge/refund calls, permissions, schema, API contracts or app behavior are introduced. Durable financial exception states and access rules below are proposals requiring owner approval.

## Existing flow and safeguards

| Flow | Implementation and evidence |
|---|---|
| Cash USD | `counter.service.ts: payOrder` records the authoritative order total in USD cents and starts preparation. Cash received/change are calculated in the UI and are not persisted as tender movements. |
| Cash KHR | Loads the tenant rate, requires it to equal the cashier's submitted rate, rounds via existing `toRiel`, stores amount KHR and rate with the payment. Historical payments do not revalue. |
| Manual KHQR | Cashier confirms money seen in their bank app. Optional QR id is checked against tenant/order/branch; optional reference retained. An expired QR may be confirmed, but manual payment still checks the order's pay-by deadline. This is existing policy, not bank verification. |
| Automatic KHQR | Authenticated, permission-checked route loads the cafe's sealed token; checks the stored QR MD5 with Bakong; matches recipient/currency/amount; records a payment through the same guarded command. No app endpoint here initiates a transfer. |
| Command integrity | `commands.ts: runOrderCommand` writes transition, version event, payment, outbox/audit and idempotency together. `counter_payments_order_idx` allows one local payment per order. |
| Replay | Manual requests retain one key while retrying an unchanged form. Automatic checks key the operation by QR; after a committed payment, read-back recognizes that QR. Idempotency scope includes actor, so two cashiers still need the version/unique guards. |
| Late payment | Verified bank money is accepted after the order deadline if the order still awaits payment. If cancellation/expiry or another payment already won, it returns `refund_needed`; no automatic refund or reopening. |
| Refunds already built | Preparing orders can be cancelled with return method; ready/completed full refunds are owner-only within 30 days. Completed orders retain completion status/time. Returns are recorded by people after an external/manual return; this is not an API refund. Partial refunds are not implemented. |
| Isolation | Tenant predicates, branch membership, charge ownership checks and composite tenant foreign keys exist. Superadmin is not implicitly a cafe cashier. Never bypass these for recovery. |
| Bank uncertainty | Network/auth/refusal/malformed/oversized responses become unavailable, not paid; not-found becomes waiting. Bakong read timeout is 8 seconds; payload reads bounded to 16 KiB. No screenshots/browser redirects establish a successful bank payment. |

Sources: `server/features/orders/{counter.service,commands,khqr.service,khqr-check.service,khqr.repository,bakong,refund.service,expiry.service,orders.repository,orders.schema}.ts`, counter check/pay routes, `CounterOrderPanel.vue`, `CounterKhqr.vue`, `useCounterActions.ts`, [current security permissions](../server/security.md#roles-and-permissions), [KHQR plan](../plans/khqr.md), existing counter/KHQR/refund/tenancy tests. Historical system-blueprint wording about required accounts and accept steps is superseded by current source/security decisions; it is not used to invent a walk-in policy.

## Scenario review

| Requested scenario | Present handling | Finding / remaining work |
|---|---|---|
| Bank confirms, Worker fails before saving | Recheck by stored MD5 can record once after recovery; check lease expires in 4 s | **High:** no scheduled recovery when screen is abandoned. New test injects batch failure after confirmed bank answer, then retries on the real migrated SQLite database. A process kill is not simulated. |
| Confirmation repeated / response lost | Same QR read-back and payment version/unique guards; manual key replay | Existing migrated database tests cover retries and same-QR overlapping cashiers. Do not promise exactly-once external transfers; the app does not initiate them. |
| Two cashiers | Status/version guard and unique payment row | Existing forced write-boundary tests cover manual pay/pay and pay/cancel. New test covers two independently paid USD/KHR charges competing for one order. |
| KHQR after cancel/expiry | Returns refund-needed, preserves cancelled order | Existing sequential tests plus new in-flight expiry test. **High:** extra receipt/refund obligation has no durable record. |
| Cash versus KHQR | One local payment wins, other bank receipt returns refund-needed | New bank callback commits cash while check is in flight. No rewriting cash as KHQR; the extra receipt must be separately reviewed. |
| Refund needed but unrecorded | UI toast persists until dismissed, no exception write | **High confirmed:** normal order refund endpoint cannot represent an extra KHQR receipt on an order with no corresponding payment row, or a second receipt on an order paid cash. Do not refund the original cash payment to model this. |
| Network timeout / unknown outcome | Waiting/unavailable; no guessed success | Retry the same command/key and inspect current server state. Durable receipt discovery still requires an independent worker scanning retained charges or a deliberate owner lookup. |
| Exchange rate changes | Cash checks displayed rate before batch; QR snapshots amount/currency/rate | **Static gap requiring reproduction:** a rate changes after validation but before commit. No commit-time rate guard. Existing committed-payment replay intentionally survives later rate changes. Do not silently change rate selection/revaluation rules. |
| Manual deadline crossed while in flight | Deadline is checked against supplied request-start `now`; SQL transition guards version/status only | **Static gap requiring reproduction:** if expiry has not committed, a held manual command may commit after its deadline. Bank-confirmed late-arrival policy is intentionally different and must be retained. |
| Concurrent status changes | Command reads plus commit status/version predicate | Existing real SQLite interleavings cover cancellation and duplicate commands. New tests cover external-response interleavings; these are not live D1 replica/load tests. |
| Currency precision | Stored QR values are integer cents/riel; bank matcher rounds supplied amount | Existing policy normalizes by rounding; malformed types rejected. Any tighter precision/timestamp acceptance rule needs bank-spec evidence and explicit financial-policy approval. No such change here. |
| QR creation while status/settings change | Checks order/settings/rate before a separate insert; old QR may remain visible | Static race candidate: generation is not an atomic reservation/charge. Review lost/repeated generation, settings changes and payment/cancel interleavings separately. Extra QRs increase recovery importance. |
| Authorization changes in flight | Permission is checked at route entry; tenant queries remain explicit | Concurrent revocation/suspension at commit remains a separate reproduction task. Do not claim route tests prove immediate revocation during an in-flight operation. |

## Why the receipt can disappear from the operator's workflow

1. `khqr_charges` retains the QR and MD5, which is useful recovery evidence.
2. `checkKhqrCharge` takes a short database lease, asks Bakong, then attempts local payment.
3. If another method/cancellation already won, it returns a response; it does not persist the bank receipt or create an obligation.
4. `CounterOrderPanel.onKhqrRefund` shows an infinite-duration toast. Dismissing it, logout, reloading or losing the response loses that UI reminder.
5. `CounterKhqr` checks only while mounted and stops five minutes after QR expiry. No `server/tasks` bank-reconciliation task exists in the reviewed tree.

An exception insert *after* a bank response alone does not close the crash gap: the Worker could fail immediately before that insert. Recovery must also begin from a durable charge/check obligation written before the external lookup (existing retained charges are a potential starting point).

## Smallest proposed recovery slice — approval required

Do not introduce an event bus, a payment gateway, automatic refunds or new charges.

1. **Discovery independent of the tablet:** bounded server-side checking of retained unresolved KHQR charges, including orders paid cash or cancelled, with persistent retry timing/lease state. Reuse the existing bank adapter and lease facilities after confirming provider limits and a business-approved search horizon. Initial scope may instead be an owner-initiated recovery scan; that is smaller but does not guarantee unattended discovery.
2. **Durable exception:** tenant, branch, order and QR ids; reason; expected and observed recipient/currency/integer amount; charge's exchange-rate snapshot; full provider transaction hash/reference when supplied; observed/provider times; first/last seen; version; review/resolution fields. Never store tokens or the complete bank response/payer identity unnecessarily.
3. **Deduplication:** unique source identity within tenant/provider and charge/transaction context; repeated observations update one unresolved case. Keep distinct real receipts distinct. An absent provider transaction id is unresolved identity evidence, not license to assert global uniqueness from amount/time. Agree behavior before migration.
4. **No invented settlement:** unresolved/uncertain is never paid. Record observations without changing the order. Reuse existing guarded payment commands only for independently verified eligible payments and only under an approved recovery policy; do not attribute unattended work to an arbitrary cashier.
5. **Owner review:** branch/tenant-scoped list, supporting order/payment history, retry bank lookup, and an explicit manual resolution after real bank evidence. Recording a refund requires reason, amount/currency, actual return evidence/reference, actor, time, idempotency and version. Resolved cases remain history. Audit and state change are one atomic batch.
6. **Recovery surfaces:** simple unresolved-count link in Payments, a review list and detail; no distracting customer payment promises. Nuxt UI conventions, phone/tablet layouts, loading/error/empty/stale states and refusal copy follow the existing standards.

Proposed state names such as needs-review and resolved are planning terms only. Do not add them to production contracts without approval.

### Owner decisions before implementation

| Decision | Recommended initial choice and consequence |
|---|---|
| Who sees and resolves cases? | Owner-only resolution; decide whether branch cashiers/managers may view or acknowledge. This is a new permission/data-visibility decision. |
| Search horizon and retry budget? | Approve how far after expiry/closing a charge is checked, and how long unresolved cases remain actionable. Confirm actual Bakong account quotas/token/access constraints first; no new quota number is assumed. |
| Extra receipt resolution? | Record a manually verified return separately from the original order payment; no automatic money movement or automatic order revival. Approve required evidence and currencies. |
| Missing bank transaction id / repeat transfers? | Keep case unresolved until evidence identifies the receipt; agree duplicate-observation and multiple-receipt rules. |
| Audit/retention? | Align new financial history with existing five-year records and privacy rules; approve the exact fields and access. Never log the raw token or bank payload. |
| Manual payment deadline/rate boundary? | Preserve “refuse after deadline/current displayed rate” and explicitly settle whether that means request start or commit; reproduce with controlled database-time tests before coding. |
| Background success attribution? | Choose a system actor and an approved eligible-payment recovery policy, or make the first slice owner review only. Do not impersonate a cashier. |

## Test evidence and next implementation gate

Added to `server/features/orders/tests/khqr-check.service.test.ts`:

- bank-confirmed answer then database batch failure, followed by successful recheck and duplicate replay;
- cash commits during an in-flight bank check;
- expiry commits during an in-flight bank check;
- two confirmed charges in different currencies concurrently compete for one order.

The database is SQLite built from the actual checked-in migrations; service/payment/guard writes are real. Bakong is a controlled mock and only selected scheduling/failure boundaries are injected. Existing tests additionally cover wrong tenant/branch/charge, invalid bank fields, same-QR races, idempotency mismatch, stale versions, refund guards and expiry races. These tests do not verify a live Bakong transaction, provider settlement, production Worker restarts or distributed D1 behavior.

Local pnpm cannot start in this session (Corepack EPERM; fetching pnpm into a writable cache is network-blocked). CI results are recorded in progress after completion. No new guard was introduced, so there is no new guard-removal claim. A future implementation must independently remove each financial/tenant/idempotency guard, observe the relevant database regression fail, restore it and rerun.

Before a behavior PR: settle the owner decisions, reproduce rate/deadline/QR-generation races on migrated SQLite and local workerd/D1, then implement one narrow safeguard. Add two-cafe isolation, unauthenticated/wrong-role/branch routes, duplicate/lost command responses, callback failure, lease expiry, repeated/partial bank failures and UI recovery tests. Keep mocked browser evidence separate from real server/database evidence.

## External references checked

- [NBC Bakong Open API documentation](https://sit-api-bakong.nbc.gov.kh/document): MD5/hash/reference lookup contracts. This is a public SIT document; it does not prove production availability, quotas or webhook/refund support.
- [NBC published Open API PDF](https://bakong.nbc.gov.kh/download/KHQR/integration/Bakong%20Open%20API%20Document.pdf).
- [Current project KHQR policy](../plans/khqr.md) and [operations setup](../server/operations.md#khqr). Historical claims of free/unlimited access are not newly asserted or used to choose a reconciliation polling budget.
