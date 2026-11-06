# Current-state navigation

Snapshot reviewed against main `ff2ca27` and GitHub's PR list, 2026-11-06. Read only when resuming or planning work. This is a compact navigation summary, not evidence of a deployment or replacement for the relevant progress row. Update it when active work changes.

## In review

- **Server P2 reliability fixes (D267), PR #268:** B3–B7 payment/QR guards, consistent order/report reads, atomic confirmation attempts and promotion-scoped retries. Updated against main `ff2ca27`; preserves the customer-order index and KHQR recovery from merged PR #267 (D265/D266). Original head CI passed all six browser shards; the integrated revision must pass fresh PR checks before merging. [Progress](progress.md#server-p2-reliability-fixes-d267-2026-11-06).

## Waiting on the owner

- **Backups are not proven (highest risk).** PR #253 (export polling contract) merged 2026-11-03; no production run, real encrypted R2 copy, full decryption or isolated D1 restore has been verified since. Do not deploy, trigger or restore without owner approval. Runbook and evidence: [progress](progress.md#d1-backup-export-contract-repair-pr-253-2026-11-03), [operations](server/operations.md).
- **Google sign-in on staging (D260–D262).** Merged: #255, #256, #257 (popup), #259 (admin/counter/platform + two-step), #260 (app-wide COOP), #264 (phone popup returning to the original tab). Every one was checked with mocked Google only; a real Google sign-in has not succeeded on staging from desktop, phone or a workspace. Earlier owner reports still open: Google chooser styling. [Setup and checks](plans/google-auth.md), [latest progress](progress.md#google-sign-in-stuck-after-the-popup-on-phones-d261-follow-up-2026-11-05).
- **Motion review on staging (D263, D264; #262, #263, #265).** Cart and counter board feel, field error leave, quantity roll, Clear order, checkbox tick. Open: whether the order tracker's looping step stays. [D263](progress.md#interaction-motion-d263-2026-11-05), [D264](progress.md#leave-animations-and-controls-d264-2026-11-05).
- **Closed without merging, no reason recorded:** #258 (time spent preparing/waiting for pickup) and #261 (account layout polish). Ask before redoing them. (#254 and #196 were redone at the owner's request: D265, D266.)
- **Security checklist (D244):** the owner works through the [owner security checklist](plans/cloudflare-improvements.md#owner-security-checklist-d244).
- **Small owner items:** the platform page's contact line waits for the Telegram contact ([progress](progress.md#the-platforms-page-at--d221-follow-up-2026-10-27)); installable apps' iOS check, platform logo (QT1) ([progress](progress.md#installable-counter-and-admin-d202-2026-10-24)).
- **Production** is live at `https://angder.app` since 2026-10-26 (D211–D214; staging `https://staging.angder.app`). Deploys are manual on `main` behind the `production` environment's reviewer ([operations → Production](server/operations.md#production-step-82-d211)). Left of 8.2: the backups above. [Phase 8](progress.md#phase-8-launch).

## Open code follow-ups (not started)

Each is its own step and branch.

- **Account security step 5: Switch person on the counter** ([plan](plans/account-security.md)). Steps 1–4 merged (D242, D243, D246–D248); step 5 has no code yet.
- **First-load rule (D238):** check other pages against the UI checklist item, one page per branch ([progress](progress.md#review-orders-first-load-and-the-first-load-rule-d238-2026-10-30)).
- **KHQR recovery follow-ups (D266):** an owner "check again" action, a Telegram alert for new review cases, explicit Bakong 429 handling. The next free migration number is `0058`.
- **CSP `script-src 'unsafe-inline'`:** still pending a hash/nonce policy ([security → Request protection](server/security.md)). The customer menu is server-rendered and edge-cached (`swr`), so per-request nonces don't fit; a hash policy needs its own decision.
- **Upgrade follow-ups:** nuxt 4.6.3 in its own run; remove the four unused `simple-git` audit exemptions (D54) from `pnpm-workspace.yaml`.
- **Left open after D253:** the menu's lazy-load candidates (measure first) and Wrangler's `Duplicate key "payload"` warning.
- **Audit N9 remainder:** expired Telegram/marketing link cleanup is bounded (500 per call) but still runs in the Connect request across cafes, not in scheduled maintenance. Low priority.
- **Live updates:** other devices' changes show on tab return or navigation; pushes are planned ([plan](plans/live-updates.md)).

## Server audit status (2026-10-14 reports)

[Server audit](reviews/server-audit-2026-10-14.md) S1–S8 and [follow-up audit](reviews/server-followup-audit-2026-10-14.md) N1–N8 are fixed in the code (S2/S3/S4/S7/S8 in D169; N1 D181; N2 D183; N3 D182; N4/N8 D170; N5 D184; N6, S1, S5 (D222), S6 on 2026-10-29; N7 by chunked reads in `notifications.deliveries.repository.ts`). N9 is partly fixed (above). S9 is the operational work under "Waiting on the owner". Checked against the source on 2026-10-29; the reports themselves describe the original findings.

## Recently merged (for orientation)

Details in each progress entry; all merged to main and CI green.

- **2026-11-06:** customer-order index and KHQR recovery (D265/D266, #267); live Bakong remains unverified.
- **2026-11-05:** interaction motion (D263, #262/#263) and leave animations (D264, #265); Google phone popup fix (#264); app-wide Google popup COOP (D261, #260).
- **2026-11-03/04:** Google sign-in and sign-up (D260, #255/#256), popup (D261, #257), at all workspaces with two-step (D262, #259); D1 backup export repair (#253, not production verified); platform UI fixes (#250); auth page state consistency (D258, #249); checkout validates at commit (D257, #248).
- **2026-11-01/02:** e2e HTML validation (D256, #247); Nuxt Hints not adopted (D255, #246); platform order activity indexed reads (#238); e2e failure evidence (D249, #237); account security steps 1–4 (D242, D243, D246–D248, #231–#236); security hardening (D244, #233); signed-in site root (#240).
- **2026-10-30:** first-load rule (D238, #225); workspace doors (D239–D241, #226–#229); account erasure (D237, #224); idle guests emptied (D236, #223); Angder console and production assistant (D232, D230, #222); one membership per person and cafe (D235, #221); owner refunds (D233/D234, #218/#219, deployed).
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
