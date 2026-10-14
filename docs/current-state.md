# Current-state navigation

Snapshot reviewed against main `9159866`, 2026-10-14, with D169 branch status below. Read only when resuming or planning work. This is a compact navigation summary, not evidence of a deployment or replacement for the relevant progress row. Update it when active work changes.

- **Active server performance/security work (D169, 2026-10-14):** `fix/server-performance-security`, based on main `9159866`. [Plan](plans/server-performance-security.md), [progress/evidence](progress.md#server-performance-and-security-d169-2026-10-14), [shared APIs](reference/server-reliability.md). Audit S2/S3/S4/S7/S8 implemented. Lint/typecheck, 1,460 unit/server tests and standard Worker build passed; browser run 563 passed / three renderer crashes, all three passed isolated reruns. Locally verified; PR review pending. Production policy/configuration follow-ups remain explicit; no deployment.
- **Architecture reliability (D168):** merged via PR #115 in base revision `9159866`. Prior local verification is recorded in [progress](progress.md#architecture-reliability-d168-2026-10-14). This source merge does not establish a successful staging deployment or production setup.

- **Architecture in use:** one Nuxt/Nitro app, no Spring SDK or `/api/v1` menu (D39/D43/D71). Customer menu is server-rendered; admin/counter/platform workspaces are SPAs. Better Auth organization = cafe; tenant-scoped APIs and pages are built (T1, D135–D141). Self sign-up/billing remain deferred (T3/QT2).
- **Latest recorded UI work:** D165/D166, reorder motion, tappable AM/PM, form errors clearing, nonblocking preselection, drawer spacing and backdrop. Read UI §17 and the forms/helper sections for changes to these behaviors. Verification details remain in the decision/progress entries; do not assume they describe a new run.
- **Marketing:** M1 promotions is recorded as merged and checked on staging. M2a Telegram posting has a row saying "Done, awaiting review" while the progress header records later work as merged. Read [Phase M](progress.md#phase-m-marketing-owner-2026-10-11-d163-plan) and verify branch/review/deploy state before resuming. M2b Facebook is blocked on QM1/Q4.
- **Tenant payment settings:** T2d's row still says awaiting review/staging setup, although later header notes describe D148 as merged. Check [Phase T](progress.md#phase-t-multi-tenant-saas-ready-owner-2026-10-02-d134-plan) and operations KHQR before changing secrets or declaring rollout complete.
- **Production:** not recorded as configured. [Phase 8](progress.md#phase-8-launch) 8.2 waits on domains/email (Q4) and operational policy/Workers plan (Q24). Staging stays on Workers Free by owner choice; the old release hand check did not pass (Error 1102 under load). Read current operations/release evidence for launch work.

- **Server-only follow-up audit (2026-10-14):** [Report](reviews/server-audit-2026-10-14.md) describes original `9159866` findings, before D169. Five local probes established further improvements; both original baselines hit one flaky crypto-tamper assertion (1,440 passed). Selected S2/S3/S4/S7/S8 and the test helper are addressed in D169 above; other audit follow-ups remain explicit. No new deployment evidence.

## Blockers and retrieval

The [open-question table](progress.md#open-questions--waiting-on-others) holds the exact questions and affected steps: Q4 domains/email; Q43 production AI provider/spending; QT1 platform name/domain; QT2 commercial plan; Q24 recovery/retention/alerts/Workers plan; QT3 shared Bakong token feasibility; Q44 KHQR refund policy; QM1 Facebook review/domain prerequisites. No new answers are inferred here.

| Resume/investigate | Read bounded sections |
|---|---|
| Current feature or bug | Matching progress phase or feature row, relevant plan and standards |
| Test failure | Progress "How to verify", affected reference edge-case table, development checks |
| Operations/launch | Progress "Known limitations" / "Environment notes", operations and release-check |
| Old architecture | Decision index search, matching entry and explicit superseding entries |

## Documentation conflicts to resolve with evidence

Progress's current-state tables list early migrations/features and describe phased work as still pending; the long header contains later completion notes. Some M1 wording says both "checked on staging" and "To check on staging". Categories/Branch/Cafe conflict-reload behavior is described differently in progress's limitations and D153. The data-model cancel endpoint still says "verified customer", while security's D156 rule says shop writes allow guests/unverified users; verify that endpoint narrowly before changing it. Treat these as historical/verification ambiguities, consult the exact affected entries and verify narrowly if a task depends on them. This audit does not settle application behavior or review status.

Documentation optimization: task routes and history lookup are implemented on this branch; validation evidence is in [context audit](context-audit.md). Review/merge is still pending.
