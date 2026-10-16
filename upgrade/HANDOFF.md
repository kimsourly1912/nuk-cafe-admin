# Upgrade handoff — nuxt-ui-latest

> Single source of truth between sessions for THIS upgrade run.
> Every session reads this first and updates it before it ends.
> Created from `.claude/upgrade/HANDOFF.template.md` by `/upgrade-0-setup`.

Run: nuxt-ui-latest
Targets: nuxt@latest @nuxt/ui@latest
Branch: chore/upgrade-nuxt-ui-latest
Package manager: pnpm (12.3.4, from lockfile + packageManager)
Started: 2026-10-16

Current phase: 4 (execute), S0 done
Next: /upgrade-4-execute S1-S12. Compare every verify with `upgrade/baseline.md`.

## Versions

Node 24.17.0.

| Package | Current | Target | Notes |
|---|---|---|---|
| nuxt | 4.5.2 | 4.6.1 | TARGET. Requires vue-router ^5.4.0, vue ^3.5.43 |
| @nuxt/ui | 4.11.2 | 4.12.0 | TARGET. Peer ranges OK (tailwindcss ^4, vue-router ^4.5 or ^5, valibot ^1, typescript ^5.6/^6/^7, @internationalized/date ^3, ai ^6 or ^7, all optional) |
| vue | 3.5.43 | ^3.5.43 (no change) | nuxt 4.6.1 needs ^3.5.43 |
| vue-router | 5.3.1 | >=5.4.0 | Direct dep; nuxt 4.6.1 depends on ^5.4.0, so must be bumped |
| nitropack | 2.13.4 (transitive) | via @nuxt/nitro-server 4.6.1 | Check resolved version after install |
| h3 | 1.15.11 (pinned) | unchanged | |
| vite | 8.3.1 (transitive) | via @nuxt/vite-builder 4.6.1 | nuxt 4.6.1 has optional peer rolldown ~1.2.1 (not required) |
| tailwindcss | 4.3.3 | ^4.3.3 (@nuxt/ui dep) | no change |
| typescript | 6.0.3 | unchanged | in @nuxt/ui peer range |
| vue-tsc | 3.3.11 | unchanged | |
| @nuxthub/core | 0.10.8 | 0.10.8 (latest) | no newer release |
| @nuxtjs/better-auth | 0.3.5 | 0.3.10 (latest) | Not a target; peer range already OK |
| better-auth | 1.7.3 | unchanged | |
| drizzle-orm | 0.45.3 | unchanged | |
| drizzle-kit | 0.31.11 | unchanged | |
| wrangler | 4.141.0 | unchanged | |
| @nuxt/eslint | 1.17.0 | 1.17.0 (latest) | peer eslint ^9 or ^10 OK |
| @nuxt/test-utils | 4.3.2 | 4.3.3 latest | peer nuxt ^3.21 or ^4 or ^5-0 OK |
| @nuxt/icon | 2.5.1 (transitive) | ^2.5.1 | from @nuxt/ui |
| @nuxt/fonts | 0.14.0 (transitive) | ^0.14.0 | from @nuxt/ui |
| @nuxt/kit | 4.5.2 | 4.6.1 | transitive |

Module peer check against targets: no installed module has a peer range that rejects nuxt 4.6.1 or @nuxt/ui 4.12.0.
@nuxthub/core 0.10.8 declares no nuxt peer (only optional @vercel/blob), so compatibility with nuxt 4.6.1 is `Needs verification` at build time.
@nuxtjs/better-auth 0.3.5 has no pinned nuxt peer; latest 0.3.10 also accepts it.

## Baseline (before any change; from S0 on compare with upgrade/baseline.md)

| Check | Result | Notes |
|---|---|---|
| typecheck | PASS | 48s |
| lint | PASS | 33s |
| test (`pnpm test`, full) | FAIL | 46 files / 459 tests failed, almost all e2e: a worker died with "JavaScript heap out of memory" on this machine. Not caused by the upgrade. |
| test:unit (unit + server projects) | FAIL (1) | 1 failed: `server/tests/routes.test.ts > cafe routes (D140) > routes outside a cafe's address never act in one` (deep-equal of route file list). Also a worker crash (exit 3221225477) in `server/features/menu/tests/promotions.service.test.ts`. 1463 passed, 1 skipped. Log: `upgrade/logs/baseline/test-unit.log` |
| build | PASS | 218s (4 error-like lines in log, exit 0) |

Baseline notes:
- The first baseline run (`upgrade/logs/baseline-run1-invalid`) is invalid: an orphaned earlier run still held the Nuxt build lock ("Another Nuxt build is already running"). The table above is the clean rerun.
- A trustworthy e2e baseline needs per-file runs (as AGENTS.md says: changed feature e2e files) or more memory; decide before Phase 4. Before comparing after the upgrade, rerun the same files on both sides.

## Decisions

<!-- Q1: question — answer (or `pending`) — decided on <date> -->
Q1: Retire dead Reka module? — No, separate PR. Keep running test/e2e/shop-menu.test.ts after the Nuxt UI bump; a failure there is in scope. — decided 2026-10-16
Q2: Bump @nuxtjs/better-auth to 0.3.10? — No. Separate upgrade run later. — decided 2026-10-16
Q3: Reliable e2e baseline? — Plan step S0 before any dependency change: split unit/server tests (every step) from e2e (milestones only: after nuxt bump, after nuxt-ui bump, final), run e2e serially or with low maxWorkers, re-take the baseline twice and mark flaky tests. — decided 2026-10-16
Q4: Failing "routes outside a cafe's address never act in one" — Not accepted as a normal baseline failure. Investigate separately (tenant isolation). Record it as a known, explained failure in baseline.md; it must not get worse. — decided 2026-10-16
Q5: @nuxt/ui 4.12.0 below pnpm minimum-release-age — Wait; no exclusions (supply-chain protection stays on). Prep steps (S0 etc.) proceed now; the bump step waits. The bump step must report any transitive packages refused by the age rule. — decided 2026-10-16
Q6: Nuxt 4.5 workaround in useApiQuery — Keep and log a follow-up, ONLY if proven harmless on 4.6: useApiQuery tests pass AND request count / refresh behavior unchanged (test or manual network check). If not harmless, fix in this run. — decided 2026-10-16
Q7: Proving the Cloudflare entry (C17) — Before merge: staging build + wrangler.json diff + `wrangler deploy --dry-run` + local `wrangler dev` smoke test (login, one D1-backed API call). After merge: smoke-test the staging deploy before production; rollback = wrangler rollback. Claude does not deploy. — decided 2026-10-16

## Done

S0: verify script split (test:unit every step, `--e2e` at milestones, 1 worker, 4 GB heap). Baseline retaken twice in `upgrade/baseline.md` (comparison source from now on): serial e2e is green (46 files / 566 tests) except one flaky test; the Q4 test fails only on Windows path separators.

## Blocked

## Plan issues

## Manual tests to do

<!-- risk: high items from Phase 2: C12 useApiQuery/useAsyncData, C14 navigateTo redirects, C15 error rendering, C17 Cloudflare entry/nitro hooks -->
