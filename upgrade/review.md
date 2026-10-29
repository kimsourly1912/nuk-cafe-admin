# Upgrade review — nuxt-4-6-2
Base: main (`9fe5f71`) | Commits: 14 | Verify (final): typecheck PASS, lint PASS, test:unit PASS (2104 passed, 1 skipped), build PASS (13 warnings: font providers unreachable in this sandbox) — equal to the baseline

Diff: `package.json` (2 lines: `nuxt ^4.6.2`, `vue ^3.5.44`), `pnpm-lock.yaml`, `docs/progress.md`, `docs/current-state.md`, and this run's `upgrade/` files. No source, config or test file changed. Resolved versions on this branch vs main: nuxt 4.6.1 → 4.6.2, @nuxt/nitro-server/kit/schema/vite-builder → 4.6.2, vue and @vue/* 3.5.43 → 3.5.44; unchanged: h3 1.15.11 (and the h3 2 rc some tools already used), nitropack 2.13.4, better-auth 1.7.7, @nuxtjs/better-auth 0.3.7, @nuxthub/core 0.10.8, drizzle-orm 0.45.3, wrangler 4.141.0, vue-router 5.4.0.

## Critical
None.

## Important
None.

## Improvement

### I1 — The app's own path checks are still case-sensitive
- where: `server/middleware/31.cafe-pages.ts:14` (`/^\/c\/([^/?#]+)/`), also `server/middleware/10.origin-check.ts:12-13`, `server/utils/rate-limit.ts:15-41`, `server/error-handler.ts:30`
- problem → why it matters → recommended fix: Vue's router matches page paths in any case, so `/C/<slug>` renders a cafe page while the cafe-existence and paused-cafe check (D143) skips it; the route rules now match any case (this upgrade), the app's own checks don't. API paths are unaffected (Nitro's handler router is case-sensitive: `/API/...` is 404, S1/S3). Not caused by the upgrade and not a data leak (every API call still checks the tenant), but it's inconsistent. Fix in its own step: compare the lower-cased path in `31.cafe-pages.ts` (or redirect case-variant `/c/` paths to the lower-case form), with a test; check the other prefixes only where a page path is involved.
- executor: sonnet (separate branch/PR, not this run)

### I2 — An e2e test depends on Have I Been Pwned being reachable
- where: `test/e2e/shop-account.test.ts:258` (through `server/api/password-ranges/[prefix].get.ts`, D210)
- problem → why it matters → recommended fix: the e2e server calls the real password-range service; offline (this sandbox) the page logs a 503 and the test fails, on 4.6.1 too. CI passes only while that third-party service answers. Point the e2e server's range lookup at a stand-in, as the suite already does for Bakong (`fake-bakong.ts`).
- executor: sonnet (separate step)

### I3 — Repoint the progress entry's links when the run is archived
- where: `docs/progress.md` → "Nuxt 4.6.2 (security patch, 2026-10-29)"
- problem → why it matters → recommended fix: it links to `upgrade/*.md`, which `/upgrade-6-finish` deletes. Point them at `docs/upgrades/2026-10-29-nuxt-4-6-2.md` in phase 6.
- executor: phase 6

## Optional
- O1: `pnpm-workspace.yaml` ignores four `simple-git` advisories (D54) that no longer apply: `@nuxt/devtools` 3.4.4 dropped `simple-git`. Remove them in a small chore with `pnpm audit` as the check.
- O2: nuxt 4.6.3 (2026-10-27) in its own small run, once it has some age (Q1).
- O3: `scripts/upgrade-verify.sh` is committed as mode 100644; `git update-index --chmod=+x` lets the README's command work as written.
- O4: the counter "Sold out" e2e test is load-sensitive locally (fails on 4.6.1 and 4.6.2 under several files at once, passes alone); recorded under progress → How to verify. Watch CI; harden only if it fails there.

## High-risk areas (profile order)
1. Authentication: Better Auth, its handler and cookie defaults unchanged (same versions); the `auth: 'user'` gates now also match case-variant paths (stricter, S3); the origin check unchanged. OK.
2. Authorization: no change; every route's own permission checks unchanged. OK.
3. Data scoping: no change. OK.
4. Concurrency (409 on stale edits): no change; covered by the unit and e2e suites. OK.
5. Server behavior: route-rule matching changed as intended (C1, before/after probe: only the two case-variant token pages differ); status codes, error shapes and middleware order unchanged; `swr` menu cache unchanged for normal paths. OK.
6. Runtime config & secrets: no config change. OK.
7. Database: no change (same drizzle, migrations untouched). OK.
8. Cloudflare entry: staging `wrangler.json` identical, dry run +0.08%, local `wrangler dev` smoke passed (S3). OK.

## Breaking-change coverage
| ID | Handled by | OK? |
|---|---|---|
| C1 route rules case-folded | S2 (bump), S1/S3 (before/after probe, Worker smoke) | yes |
| C2 router params from h3 match | S2 verify, S3 full e2e (SSR menu, deep links), Worker smoke | yes |
| C4 rooted paths via URL parser | S3 full e2e (navigation, redirects, trailing slash) | yes |
| C5 type generation | S2/final typecheck | yes |
| C6 server auto-imports | S2/final typecheck and build | yes |
| C7 bundling | S3 staging build, `wrangler.json` diff, dry run, Worker smoke | yes |
| C11 navigation fixes | S3 full e2e | yes |
| C14 Vue 3.5.44 | S2 unit, S3 full e2e | yes |

## Manual test checklist (final)
On staging after merge (main deploys there):
- Profile smoke test: sign in, sign out, session refresh, expired session, a protected route without a session (expect refusal), one CRUD flow (menu item edit), one stale edit (expect 409), dashboard pages, one form's validation, dark mode.
- `curl -sI https://staging.angder.app/TABLE/anything | grep -i cache-control` → `no-store, no-transform`.
- The customer menu `/c/<slug>` loads server-rendered; a second visit is fast.
- A deep link such as `/c/<slug>/admin/products` opens after sign-in.
- The counter queue's reorder motion still animates.
