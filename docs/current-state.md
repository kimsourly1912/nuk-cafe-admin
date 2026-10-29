# Current-state navigation

Snapshot reviewed against main `2721713`, 2026-10-29: no pull request open, main CI green. Read only when resuming or planning work. This is a compact navigation summary, not evidence of a deployment or replacement for the relevant progress row. Update it when active work changes.

## Waiting on the owner

- **Active: page addresses match their exact case (D226, 2026-10-29):** branch `ccr-c6503e1b-4fiibm`, with the current-state refresh; not yet in a PR. `/C/<slug>` skipped the cafe check (unknown and paused cafes rendered with 200); the router is now case-sensitive. [Decision](decisions.md#d226-page-addresses-match-their-exact-case-2026-10-29), [progress](progress.md#page-addresses-match-their-exact-case-d226-2026-10-29).
- **Nuxt 4.6.2 security patch:** merged (PR #212, upgrade run `nuxt-4-6-2`, [record](upgrades/2026-10-29-nuxt-4-6-2.md)). The owner runs the manual smoke test on staging, including `curl -sI https://staging.angder.app/TABLE/x`, which answers 404 once D226 is deployed (before it: `cache-control: no-store, no-transform`). [Progress](progress.md#nuxt-462-security-patch-2026-10-29).
- **Nightly backups (D225):** merged (PRs #210, #211); `angder-backup` exports production nightly, encrypted for the owner's age key, into R2 bucket `angder-backups`, in the production account for now (they don't survive losing that account). The owner sets it up and runs **Deploy backup** ([operations → Nightly backups](server/operations.md#nightly-backups-d225)), then the restore drill. Until the drill passes, recovery is unproven. [Progress](progress.md#nightly-backups-in-a-separate-account-d225-2026-10-29).
- **Production launch, rest of 8.2:** live at `https://angder.app` since 2026-10-26 (D211–D214; staging `https://staging.angder.app`, both on Workers Paid; email through Cloudflare Email Sending; Bot Fight Mode off). Deploys are manual on `main` behind the `production` environment's reviewer ([operations → Production](server/operations.md#production-step-82-d211)). Left: the first super admin and cafes, `@angders_bot`'s webhook, the production restore drill, the release hand check on staging, DNSSEC (D215). Not recorded as done: `NUXT_TELEGRAM_BOT_USERNAME` as a Worker secret before the health-thresholds deploy ([progress](progress.md#production-health-thresholds-d221-follow-up-2026-10-27)); verify before the next production deploy. [Phase 8](progress.md#phase-8-launch).
- **Small owner items:** the platform page's contact line waits for the Telegram contact ([progress](progress.md#the-platforms-page-at--d221-follow-up-2026-10-27)); installable apps' iOS check, platform logo (QT1) ([progress](progress.md#installable-counter-and-admin-d202-2026-10-24)).

## Open code follow-ups (not started)

Each is its own step and branch.

- **Customer order index (performance):** PR #196 (`orders_tenant_customer_status_due_idx`, migration 0050 on its branch) was closed unmerged as a ~9,000-line draft with conflicts; no reason recorded. The only customer index is still `orders_customer_idx (customer_id, placed_at)`. Ask the owner whether it was rejected before redoing it as a small PR; the next free migration number is `0052`.
- **One membership per person and cafe (data integrity):** `member` has no unique `(organization_id, user_id)` (noted in [D184](decisions.md#d184-the-staff-list-starts-from-the-cafes-memberships-not-from-every-account-2026-10-19)); PR #119, which added it, was closed unmerged. Needs a duplicate check on existing data before the migration.
- **CSP `script-src 'unsafe-inline'`:** still pending a hash/nonce policy ([security → Request protection](server/security.md)). The customer menu is server-rendered and edge-cached (`swr`), so per-request nonces don't fit; a hash policy needs its own decision. Docs also disagree with the code on `Referrer-Policy` (`security.md` says `strict-origin-when-cross-origin`, `nuxt.config.ts` sends `strict-origin`).
- **Upgrade follow-ups:** nuxt 4.6.3 in its own run; remove the four unused `simple-git` audit exemptions (D54) from `pnpm-workspace.yaml`; give the e2e server a stand-in for Have I Been Pwned (`shop-account` calls the real one).
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

The [open-question table](progress.md#open-questions--waiting-on-others) holds the exact questions and affected steps: Q43 production AI provider/spending (AI is off in production); QT1 platform name (emails say Angder, D213); QT2 commercial plan; Q24 RTO, retention and erasure (plan, alerts and backups answered); QT3 shared Bakong token feasibility; Q44 KHQR refund policy; QM1 Facebook review/domain prerequisites. No new answers are inferred here.

| Resume/investigate | Read bounded sections |
|---|---|
| Current feature or bug | Matching progress phase or feature row, relevant plan and standards |
| Test failure | Progress "How to verify", affected reference edge-case table, development checks |
| Operations/launch | Progress "Known limitations" / "Environment notes", operations and release-check |
| Old architecture | Decision index search, matching entry and explicit superseding entries |

## Documentation conflicts to resolve with evidence

Progress's current-state tables list early migrations/features and describe phased work as still pending; the long header contains later completion notes. M1 promotions and M2a Telegram posting are merged (PRs #110, #111), but M1 wording says both "checked on staging" and "To check on staging", and M2a's row still says "awaiting review"; M2b Facebook is blocked on QM1/Q4 ([Phase M](progress.md#phase-m-marketing-owner-2026-10-11-d163-plan)). T2d per-cafe Bakong tokens are merged (PR #97), but its row still says awaiting review/staging setup; check [Phase T](progress.md#phase-t-multi-tenant-saas-ready-owner-2026-10-02-d134-plan) and operations KHQR before changing secrets or declaring rollout complete. Categories/Branch/Cafe conflict-reload behavior is described differently in progress's limitations and D153. The data-model cancel endpoint still says "verified customer", while security's D156 rule says shop writes allow guests/unverified users; verify that endpoint narrowly before changing it. Treat these as historical/verification ambiguities, consult the exact affected entries and verify narrowly if a task depends on them. This summary does not settle application behavior or review status.
