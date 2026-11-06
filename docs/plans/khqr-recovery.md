# KHQR recovery — implementation proposal

Status: **decided and built (D266, 2026-11-05)**. The owner answered the three decisions below with the recommended first version: owners only, automatic attach while the order awaits payment, a 24-hour window. The implementation, its differences from this proposal and its verification are in [D266](../decisions.md#d266-khqr-recovery-the-server-keeps-checking-each-qr-owners-review-payments-an-order-couldnt-take-2026-11-05); this page keeps the original proposal for context.
Prepared 2026-11-04 against main `2fb9ad17ae4740c2fadf0796a07a8d8d95fb1d9a` and the audit/tests in [PR #254](https://github.com/kimsourly1912/nuk-cafe-admin/pull/254) (closed unmerged; its audit, plan and four tests are carried into the D266 change).

**Differences from the proposal, as built:** the work lives on `khqr_charges` itself (no separate work table); receipt evidence is kept on the review case (hash, reference, amount), not in its own table; a background payment's `collected_by` names the QR's cashier because the column is required (event and audit have no actor); no owner "retry" action, Telegram alert or explicit 429 handling yet.

## Result to deliver

If a customer pays a saved QR while the tablet closes or a database write fails, retained work must allow another process to discover that receipt. If the original order can still accept it under the agreed rule, record payment once. Otherwise keep a visible review case after logout, reload and retry. Never describe a bank timeout as unpaid, or an app-recorded return as a bank-executed refund.

## Three decisions to settle

| Decision | Recommended first version | Alternative / consequence |
|---|---|---|
| Access and manual resolution | Cafe owners alone see, retry and resolve cases. A recorded external return needs actual currency/amount, method, return time, reference/evidence note and reason. Retain versioned financial/audit history under the existing five-year policy, subject to confirming these new fields. | Managers could view their branch's cases, requiring a separate explicit permission. No implicit platform-support or superadmin access. |
| Background payment | Automatically attach a verified matching receipt only while the original order still awaits payment, using a clearly identified system actor and the same atomic payment/version/unique guards. Preserve the existing late-bank-payment rule; do not reopen cancelled orders or replace cash. Missing/ambiguous transaction identity goes to review. | Review-only background work is smaller and does not advance an order, but owner action is needed to recover an otherwise eligible payment. |
| Automatic search window | Target checking saved charges until **24 hours after QR expiry**, then stop automatic searching and show coverage exhaustion. Keep evidence/cases; no deletion or claim of unpaid. Enable only after provider lookup retention, access and polling budget are established. | A 72-hour target covers longer delays but increases requests. Neither window guarantees discovery during a longer outage or of every transfer against a reused QR. |

No runtime implementation should encode these recommendations as accepted policy. Record the owner's answers here and in the domain decision before the behavior PR. No automatic refund or bank-transfer API is proposed.

## Current code and specific changes

| Existing surface | Verified behavior | Planned change after decisions |
|---|---|---|
| `khqr.service.ts: createKhqrCharge` | Persists a charge/MD5 before the browser sees the QR. Order/settings/rate reads precede an independent insert. | Create durable recovery work in the same charge-insert batch. A charge insert failure cannot leave an exposed QR without work. Reproduce generation races separately rather than inventing a reservation. |
| `khqr-check.service.ts: checkKhqrCharge` | Claims a four-second check window, asks Bakong (eight-second request timeout), then attempts payment; mismatches/refund-needed answers are not durably stored. | Persist validated observation and reconciliation outcome; attach payment or save a case atomically where applicable. A crash before persistence remains recoverable from the pre-existing work. Do not swallow a failed write and report success. |
| `khqr.repository.ts: claimBakongCheck` | A time lease suppresses frequent requests; it is not a result-ownership token. | Coordinate foreground/background checks with a shared claim token and bounded lease covering request plus persistence. A stale worker cannot overwrite a newer result. Independently retain payment/receipt uniqueness guards. |
| Counter check route | Uses tenant/branch collection permission, opens that cafe's sealed token, and triggers existing paid-event delivery on success. | Retain its permission and response semantics; write safe evidence through the service. Do not add case-list access to cashiers through this endpoint. |
| Scheduled tasks / `runJob` | Existing bounded task, job-health and audit conventions. No bank-recovery task exists. | A bounded `orders:recover-khqr` task scans due work, reuses the bank adapter and sealed-token facilities, and records freshness/backlog. Recovery does not depend on a mounted browser or a minute-delayed notification handler. |
| Payments admin | Configures KHQR/token; no recovery case list. | Add an unresolved count, paginated branch-filtered list and case detail under Payments; use existing query/mutation/confirmation conventions. All access is checked server-side. |

Orders remains the owning server feature. Use repositories for SQL, services for rules, thin routes and public `index.ts` exports. No new queue product, event bus or payment gateway is needed for this first version.

## Proposed persistence

Names are provisional until policy/schema review. Do not allocate a migration number before checking current main.

- **Recovery work** per tenant/charge: composite tenant/order/branch/charge relationships, next check time, window end, attempt count, claim token/expiry, last safe problem code, last success time, coverage status and timestamps. Due-work index supports bounded scheduled reads. Missing token/refusal is visible blocked work, never payment success.
- **Bank receipt evidence**: provider, full transaction hash when present, separate external reference when present, validated recipient/currency/amount, first/last observed times and provider time when supplied. Preserve the charge's expected amount/rate snapshot. No raw bank payload, bearer token or unnecessary payer identity.
- **Observation links** connect evidence to the tenant's charge/order. One receipt observed from two charges is not two receipts or two payments. Keep conflicting observations rather than overwriting evidence.
- **Review case**: tenant/branch/order/charge, evidence link, reason, needs-review/resolved state, version, first/last seen and resolution evidence/actor/time. Cases and their financial history are retained. Concurrent resolution uses version/idempotency and audit in the same batch.
- Scope unique full receipt identity by tenant/provider/full hash. A missing hash or external reference alone is not proof of global uniqueness. Do not use amount/time/QR MD5 as a bank transaction identity. Conflicting or absent identity stays uncertain pending evidence.
- Database checks and composite foreign keys reject cross-tenant links, invalid states and negative amounts. USD integer cents and KHR integer riel remain distinct. Any precision-policy change is a separate financial decision.

A successful observation write alone does not close the crash gap. Durable work precedes the external request, and only a committed reconciliation result retires that work. Retrying after a lost commit response reads back the same result.

## Processing and failure behavior

1. Select a bounded due-work page, with fair progress across cafes and no unbounded charge/history scan. Use a per-tenant/provider budget shared by foreground and background work.
2. Claim due work atomically with token/lease ownership. Load only that tenant's token for its call; never put the token into job output or audit.
3. Call the existing validated bank adapter outside the database batch. Not-found, refusal, token failure, timeout and rate limiting have distinct safe outcomes.
4. For a confirmed answer, verify charge recipient/currency/amount using the existing matching policy. Persist the evidence and current reconciliation outcome with ownership guards.
5. Under the accepted automatic-payment choice, atomically link the receipt, guarded payment, order transition, event/outbox, audit and recovery outcome. A late failure rolls back the whole local payment. Do not call the interactive command with a made-up cashier or guest account.
6. When cash, cancellation, another receipt or an identity conflict wins, preserve the original order/payment and create/update one appropriate review case. A wrong recipient is a mismatch investigation, not proof this cafe owes a return.
7. Reschedule transient failures with bounded backoff/jitter and provider cooldown. Provider HTTP 429 needs explicit adapter classification; numeric quotas are not established by the inspected public document. Token/refusal blocks must be visible and must not hammer Bakong on every charge.
8. At the automatic window boundary, mark coverage stopped/unknown. Do not resolve an existing case or label a charge unpaid. An owner retry must show any lookup limitation and obey the same budget.
9. New provider evidence after manual resolution must not disappear behind a resolved case. Preserve history and surface a new/changed unresolved obligation under the agreed receipt identity rules.

The existing MD5 API returns a transaction object. That contract does not establish enumeration of every transfer against one QR. Do not promise complete bank-account reconciliation or that repeated scans can never miss an additional transfer.

## UI acceptance

Payments shows **Needs review** count and cases with order number, branch, observed amount/currency, reason and observed time. Detail distinguishes expected charge, bank evidence and current order/payment. Owner can retry and, under the accepted policy, record the externally verified return; no button sends money.

Use Nuxt UI semantic tokens and existing page patterns, light/dark and phone/tablet layouts. Include loading, empty, error/retry, stale-version and permission-loss behavior. Account/cafe transitions clear identity-bound queries, drafts and in-flight results. A resolved case remains accessible in history.

Keep counter wording compatible during rollout. A generic owner-review notice may replace the transient instruction only when a durable case was actually committed; a persistence failure must remain an error.

## Verification before release

| Scenario | Required result/evidence |
|---|---|
| Worker stops before observation insert | Work survives; later run rediscovers receipt. Inject process/request boundaries; do not call a thrown error a process-kill test. |
| Payment or case batch fails late | No partial payment, order, receipt assignment, audit or retired work. Recheck recovers. |
| Commit succeeds, response is lost | Retry reads the same payment/case; no second collection or case. |
| Foreground/background checks overlap, lease expires | One receipt assignment; stale token cannot overwrite the winner. |
| Cash, cancellation, expiry or second currency wins | Original state remains; distinct extra receipt needs review; no automatic refund. |
| Same hash on another QR/order; changed/missing hash | No second payment; uncertainty is visible; separate real evidence is retained. |
| Two cafes/branches and hostile IDs | Queries/relationships refuse cross-tenant data. Unauthorized/branch roles/support cannot list or resolve cases. |
| Token expiry, replacement, removal, 403/429, timeout | Safe blocked/retry state, bounded calls, visible freshness and no guessed payment. |
| Window exhausted or job outage | Coverage is unknown/stopped; existing cases persist; monitoring shows stale/backlogged work. |
| Two owners resolve, lost response, evidence changes | Version/idempotency protects one audited resolution; new evidence remains reviewable. |
| Tablet closes, reload/logout, long translated names | Durable cases remain; session state clears; UI labels/layout are accessible. |
| Upgrade and rollback | Migration fresh install/upgrade, constraints/index plans, known-charge backfill and mixed-version rollout are verified. |

Use migrated SQLite and local workerd/D1 interleavings, real route authorization and a seeded real-server browser journey. Remove each new critical guard separately, observe the relevant regression fail, restore it, then run pnpm lint/typecheck/audit/unit and affected browser suites (full suite for shared changes). Provider mocks do not prove live settlement, production geography/access or D1 failover.

## Delivery sequence

1. **This change:** reviewable design linked from the audit/current-state/progress; no runtime, schema or permission change.
2. Resolve the three decision bundles. Confirm provider lookup retention/budget and production access independently of a customer payment; do not claim live evidence from the public sample.
3. One focused behavior branch from latest main: durable work/evidence + bounded reconciliation + owner case UI and tests. Incorporate audit regressions from #254 without duplicating an unmerged implementation.
4. Review green CI, then staging with synthetic data and a controlled owner-run provider check. Production enablement is separate from merging.
5. Follow up on manual rate/deadline/QR-generation races; do not silently change them inside recovery.

## Sources and limits

- Source inspected on main: `server/features/orders/{khqr.service,khqr-check.service,khqr.repository,bakong,orders.schema}.ts`, identity permissions, counter check route and task conventions.
- [Payment audit](../reviews/payment-reliability-2026-11-03.md): confirmed failure paths and four migrated-database race tests in #254.
- [NBC Open API document](https://bakong.nbc.gov.kh/download/KHQR/integration/Bakong%20Open%20API%20Document.pdf), retrieved 2026-11-04: version 1.0.2 (2021), sections 5/6 show MD5/full-hash lookup and transaction fields; status table includes 429. This older public document does not establish current production quotas, lookup retention or multi-transfer enumeration.
- [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), retrieved 2026-11-04: batch failure rolls back the sequence. It does not transact with the bank request.
- Local Git clone could not authenticate through the CLI. Current source was read through the GitHub connection. No app checks, live Bakong call, migration, merge or deployment was performed for this documentation-only proposal.
