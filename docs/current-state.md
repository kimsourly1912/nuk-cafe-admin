# Current-state navigation

Snapshot reviewed against main `f2978f7`, 2026-11-01. Read only when resuming or planning work. This is a compact navigation summary, not evidence of a deployment or replacement for the relevant progress row. Update it when active work changes.

## Ready for review

- **Google account popup (D261, 2026-11-04):** branch `codex/google-auth-popup` from fetched remote main `800f04ef`. Local unit/server 2,492 passed/1 skipped and affected Chrome 79/79 passed; full browser run 852 passed/1 failed plus a Windows product-worker exit, both affected files passed 109/109 with one worker; lint and final typecheck passed; original sign-in/sign-up form stays mounted, callback verifies a fresh session, and popup failures allow retry. [Progress](progress.md#google-account-popup-d261-2026-11-04). No push or deployment.

## Waiting on the owner

- **KHQR recovery work started (2026-11-04, PR #254):** [concrete implementation proposal](plans/khqr-recovery.md) prepared from current main `2fb9ad1`; [audit](reviews/payment-reliability-2026-11-03.md) and four database-backed tests remain in the existing open PR. No runtime recovery behavior yet. Owner choices still needed for access/resolution evidence, background attachment/system attribution and automatic search horizon; provider quota/retention remains unverified. [Progress](progress.md#khqr-recovery-implementation-proposal-2026-11-04). Backup verification remains separate.

- **Google staging follow-up (D260):** PR #255 merged as `0e447d9` with green CI; staging deployment passed. Owner configured credentials and reported partial success, popup styling, Google disappearing after sign-out and unwanted same-email refusal. Branch `codex/google-auth-staging-fixes` changes linking for verified same-email accounts with protected-account safeguards and adds enabled-provider browser reproductions. Fresh server availability addresses missing Google on navigation; Google chooser styling remains unconfirmed. Local unit/server 2,486 passed/1 skipped; focused browser 54/54 passed; full browser run stopped at 60 passed/2 timeouts. No follow-up merged or deployed. [Setup and checks](plans/google-auth.md).

- **Merged PR #253: D1 backup export repair; production verification pending.** Corrected the polling request against the API schema/Wrangler, kept nested completion parsing and added malformed-response/interruption/synthetic restore regressions. Local pnpm checks are blocked by Corepack permissions/network; see the repair CI evidence and [progress](progress.md#d1-backup-export-contract-repair-pr-253-2026-11-03). Do not deploy or trigger without owner approval. A real encrypted R2 copy, full decryption and isolated test D1 restore are still required.

- **In review: platform UI fixes ([PR #250](https://github.com/kimsourly1912/nuk-cafe-admin/pull/250)),** including the searchable Activity filter's combobox semantics (D152); lint/typecheck/audit passed, 2453 unit/server tests passed (1 skipped), Activity E2E 10/10. [Progress](progress.md#platform-activity-searchable-filter-accessibility-pr-250-2026-11-03).
- **In review: checkout concurrency audit/fix (D257, [PR #248](https://github.com/kimsourly1912/nuk-cafe-admin/pull/248)),** branch `codex/checkout-concurrency-audit` from `26b24f7`: commit-time guards and migration-backed SQLite/local D1 regressions; lint/typecheck/audit passed, 2446 unit/server tests passed (1 skipped), full local E2E 813 passed, implementation CI green. Final verification-note update changes documentation only. [Progress](progress.md#checkout-validates-at-commit-d257-2026-11-02), [audit](reviews/checkout-concurrency-2026-11-02.md). No inventory or payment change; next financial risks recorded separately.


- **In review: auth page state consistency (D258, 2026-11-03),** full plan implemented locally on `claude/cafes-page-look`, synced with `origin/main` at `b93fa540`. Post-integration lint/typecheck passed, unit/server 2,453 passed (1 skipped), eight affected browser suites passed after an expected-error fixture adjustment (109/110 initially, auth-state rerun 21/21). Earlier full/browser layout evidence is retained in progress; full e2e was not repeated after the main integration. Owner authorized pushing this branch on 2026-11-03; generated `/output/` evidence is ignored. No deployment. Includes cross-surface identity synchronization, stable page states/redirects, reset-token cleanup, SSR photo hydration and public logout behavior. Existing Your cafes work preserved. [Plan](plans/auth-page-state-consistency.md), [evidence](progress.md#auth-page-state-consistency-fixes-d258-2026-11-02).
- **In review: platform order activity indexed reads (PR #238),** branch `codex/server-order-activity-indexed-stats`: fixed the lint issue and a Drizzle alias query error; local lint, typecheck, audit, unit/server, platform e2e and D1 query-plan checks passed. Push the repair and wait for GitHub CI; keep the PR draft until CI and staging performance evidence are reviewed. [Progress](progress.md#platform-order-activity-uses-cafe-indexed-reads-pr-238-2026-11-02).
- **In review: e2e failure evidence (D249),** branch `claude/affectionate-galileo-rivb8d`: a failed e2e test saves screenshots and HTML; CI uploads them. Step 4 (D248) merged as PR #236. Next: step 5, Switch person on the counter. [Progress](progress.md#a-failed-e2e-test-keeps-what-the-browser-showed-d249-2026-11-01).
- **Merged: account security step 2 (D243, PR #232) and security hardening (D244, PR #233).** The owner works through the [security checklist](plans/cloudflare-improvements.md#owner-security-checklist-d244).
- **In review: Review order's first load and the first-load rule (D238),** branch `claude/checkout-loading-state`. Next: other pages checked against the new UI checklist item, one per branch. [Progress](progress.md#review-orders-first-load-and-the-first-load-rule-d238-2026-10-30).
- **Merged: account erasure (D237, 2026-10-30):** PR #224 as `3ed2cbf`. Account menu → **Delete account**; `POST /api/me/delete-account`; no migration. [Plan](plans/account-erasure.md), [decision](decisions.md#d237-an-account-deletes-itself-emptied-like-a-guest-d229s-erasure-2026-10-30), [progress](progress.md#account-erasure-d237-2026-10-30).
- **Merged: idle guests emptied after 90 days (D236):** PR #223 as `b4d28cc`.
- **Merged: Angder in the console and the production assistant's config (D232, D230):** PR #222 as `b2254cf`. The owner, after its production deploy: a production-only OpenAI key with a $20 limit, as the Worker secret `NUXT_AI_API_KEY` on `nuk-cafe-production`.
- **Merged: one membership per person and cafe (D235):** PR #221 as `d798bc8`.
- **Merged and deployed: the owner's refund (D233, PR #218 as `be44d91`) and the customer seeing it on a completed order (D234, PR #219 as `4832310`).** Checked on staging by the owner (2026-10-30): works. [D233 progress](progress.md#the-owners-refund-of-a-ready-or-completed-order-d233-2026-10-30), [D234 progress](progress.md#the-customer-sees-a-completed-orders-refund-d234-2026-10-30).
- **Backup history (D225, D227, D228):** repeated production export failures continue to require the PR #253 repair and isolated restore drill described above. Earlier deployed fixes and synthetic tests did not establish a usable production backup. The previous pause/screenshot handoff is superseded by the 2026-11-03 code review; no production success is inferred.
- **Merged: a backup failure no retry can fix reports at once (D227):** PR #216 as `5f31021`. **Merged: page addresses match their exact case (D226):** PR #215 as `70c227d`.
- **Done by the owner on staging (2026-10-30):** the Nuxt 4.6.2 smoke test, the release hand check's remaining checks 1 and 4, and DNSSEC on `angder.app`: all reported working. [Progress](progress.md#owner-checks-smoke-test-release-hand-check-dnssec-production-setup-2026-10-30).
- **Production launch, rest of 8.2:** live at `https://angder.app` since 2026-10-26 (D211–D214; staging `https://staging.angder.app`, both on Workers Paid; email through Cloudflare Email Sending; Bot Fight Mode off). Deploys are manual on `main` behind the `production` environment's reviewer ([operations → Production](server/operations.md#production-step-82-d211)). The first super admin, cafes, `@angders_bot`'s webhook and the Worker secrets are set up and working (owner, 2026-10-30). Left: the backups and their restore drill (above). [Phase 8](progress.md#phase-8-launch).
- **Small owner items:** the platform page's contact line waits for the Telegram contact ([progress](progress.md#the-platforms-page-at--d221-follow-up-2026-10-27)); installable apps' iOS check, platform logo (QT1) ([progress](progress.md#installable-counter-and-admin-d202-2026-10-24)).

## Open code follow-ups (not started)

Each is its own step and branch.

- **Customer order index (performance):** PR #196 (`orders_tenant_customer_status_due_idx`, migration 0050 on its branch) was closed unmerged as a ~9,000-line draft with conflicts; no reason recorded. The only customer index is still `orders_customer_idx (customer_id, placed_at)`. Ask the owner whether it was rejected before redoing it as a small PR; the next free migration number is `0054`.
- **CSP `script-src 'unsafe-inline'`:** still pending a hash/nonce policy ([security → Request protection](server/security.md)). The customer menu is server-rendered and edge-cached (`swr`), so per-request nonces don't fit; a hash policy needs its own decision. Docs also disagree with the code on `Referrer-Policy` (`security.md` says `strict-origin-when-cross-origin`, `nuxt.config.ts` sends `strict-origin`).
- **Upgrade follow-ups:** nuxt 4.6.3 in its own run; remove the four unused `simple-git` audit exemptions (D54) from `pnpm-workspace.yaml`.
- **Audit N9 remainder:** expired Telegram/marketing link cleanup is bounded (500 per call) but still runs in the Connect request across cafes, not in scheduled maintenance. Low priority.
- **Live updates:** other devices' changes show on tab return or navigation; pushes are planned ([plan](plans/live-updates.md)).

## Server audit status (2026-10-14 reports)

[Server audit](reviews/server-audit-2026-10-14.md) S1–S8 and [follow-up audit](reviews/server-followup-audit-2026-10-14.md) N1–N8 are fixed in the code (S2/S3/S4/S7/S8 in D169; N1 D181; N2 D183; N3 D182; N4/N8 D170; N5 D184; N6, S1, S5 (D222), S6 on 2026-10-29; N7 by chunked reads in `notifications.deliveries.repository.ts`). N9 is partly fixed (above). S9 is the operational work under "Waiting on the owner". Checked against the source on 2026-10-29; the reports themselves describe the original findings.

## Recently merged (for orientation)

Details in each progress entry; all merged to main and CI green.

- **2026-10-29:** watchdog Worker (D224, deployed, delivery confirmed by the owner; [operations → Alerts](server/operations.md#alerts-d223-d224)); platform alerts (D223); option-set and add-on usage indexes (`0051_menu_usage_indexes`, PR #209); audit S1/S5/S6/N6 fixes and no rate limit on the session check (PRs #200–#204).
- **2026-10-28:** better-auth 1.7.7 patch and two flaky e2e fixes (PR #198); shared error views and sign-in state (PR #197).
- **2026-10-27:** no default cafe (D221) and one setup path per environment (D220) (PR #193); the platform's page at `/` and production health thresholds (PR #195); D1 counter queue index (D219, PR #192); public image edge cache (D218, PR #191); Turnstile bot protection (D217, PR #190).
- **2026-10-26:** monitoring baseline (D216, PR #189); Cloudflare security baseline (D215, PR #188); production at angder.app (D211–D214, PRs #186, #187).
- **2026-10-25:** password rules checklist (D210, #184); dev accounts (D209, #183); one address per page (D208, #182); UChart sales chart (D207, #181); Node 24/pnpm 12 toolchain (D205, #179).
- **2026-10-24 and earlier:** installable apps (D202–D204, #175–#178); Back closes the overlay (D201, #174); delete permanently and its staging fix (D200, #167–#173); pause orders (D199, #163–#165); manager tools (D198, #160–#162); staff access and branches (D196/D197, #158, #159); repository standard (D194, #150); platform console phase P complete (P1–P5, #140–#149); create a cafe on one page (D185, #137, #139); fewer API requests (#123–#128); D170 (#117), D169 (#116), D168 (#115); documentation routing (#114).

## Architecture in use

One Nuxt/Nitro app, no Spring SDK or `/api/v1` menu (D39/D43/D71). Customer menu is server-rendered; admin/counter/platform workspaces are SPAs. Better Auth organization = cafe; tenant-scoped APIs and pages are built (T1, D135–D141); nothing guesses a cafe (D221). Self sign-up/billing remain deferred (T3/QT2).

## Blockers and retrieval

The [open-question table](progress.md#open-questions--waiting-on-others) holds what is still open: QT2 commercial plan (deferred), QT3 shared Bakong token (test deferred), QM1 Facebook (Telegram only for now). Answered 2026-10-30: Q24 → D229, Q43 → D230, Q44 → D231, QT1 → D232. No new answers are inferred here.

| Resume/investigate | Read bounded sections |
|---|---|
| Current feature or bug | Matching progress phase or feature row, relevant plan and standards |
| Test failure | Progress "How to verify", affected reference edge-case table, development checks |
| Operations/launch | Progress "Known limitations" / "Environment notes", operations and release-check |
| Old architecture | Decision index search, matching entry and explicit superseding entries |

## Documentation conflicts to resolve with evidence

Progress's current-state tables list early migrations/features and describe phased work as still pending; the long header contains later completion notes. M1 promotions and M2a Telegram posting are merged (PRs #110, #111), but M1 wording says both "checked on staging" and "To check on staging", and M2a's row still says "awaiting review"; M2b Facebook is blocked on QM1/Q4 ([Phase M](progress.md#phase-m-marketing-owner-2026-10-11-d163-plan)). T2d per-cafe Bakong tokens are merged (PR #97), but its row still says awaiting review/staging setup; check [Phase T](progress.md#phase-t-multi-tenant-saas-ready-owner-2026-10-02-d134-plan) and operations KHQR before changing secrets or declaring rollout complete. Categories/Branch/Cafe conflict-reload behavior is described differently in progress's limitations and D153. The data-model cancel endpoint still says "verified customer", while security's D156 rule says shop writes allow guests/unverified users; verify that endpoint narrowly before changing it. Treat these as historical/verification ambiguities, consult the exact affected entries and verify narrowly if a task depends on them. This summary does not settle application behavior or review status.
