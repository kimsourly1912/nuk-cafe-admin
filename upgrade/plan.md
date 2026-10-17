# Upgrade plan — nuxt-ui-latest
Targets: nuxt@4.6.1, @nuxt/ui@4.12.0 (+ required peer vue-router@^5.4.0) | Based on breaking-changes.md (C1..C36)

## Strategy
No release in range lists a breaking change for this app, and there are no official codemods. Most of the risk is in behavior changes, not API changes. The plan therefore puts verification first and keeps code changes as small as possible:
1. Make verification trustworthy (S0, decision Q3) and capture pre-upgrade evidence that a later session can compare against (S1). `upgrade/logs/` is git-ignored, so all evidence is committed under `upgrade/evidence/`.
2. Bump Nuxt with vue-router (S2). Then check the high-risk areas in profile order (server/runtime, then the data layer, then auth redirects) before touching UI (S3–S6).
3. Bump Nuxt UI (S7), then check one UI area per step (S8–S11). Final run in S12.
Steps marked "check" change code only when the check proves breakage. A fix must be minimal and covered by a test. Anything larger is marked `blocked` and added under "Plan issues" in HANDOFF, not improvised. A check step whose check passes commits only its evidence/HANDOFF notes.
Risky: C12 (`useApiQuery` ↔ `useAsyncData`, session-bound data), C14 (auth redirects), C15 (error rendering/security headers), C17 (custom Cloudflare entry and nitro hooks; only fully proven on staging after merge).
NOT changed: `@nuxtjs/better-auth` (Q2), `modules/reka-namespaced.ts`/D123 (Q1), h3/nitropack/drizzle/better-auth/wrangler, no `future.compatibilityVersion: 5`, no opt-in 4.6 features (`nuxt/server`, `routeTypedFetch`, Vapor), no `nuxt upgrade --dedupe`, no `pnpm dedupe` of unrelated deps.

Facts settled while planning (no step needed):
- C2: CI uses `pnpm/setup` with `runtime: node@24` (`.github/workflows/ci.yml:36,71,103`), local Node 24.17.0. Both meet `^24.15.0`.
- C6: no `to=`/`href=`/`navigateTo` literal targeting `/api` or `/media` in `app/`.
- C13: no `useState(..., () => ref(...))` in `app/`.
- C24: no `@after:enter`/`@after:leave` listeners in `app/`.
- Release dates: nuxt 4.6.1 2026-10-09, vue-router 5.4.0 2026-10-07, @nuxt/ui 4.12.0 2026-10-15T13:01Z (see Q5).

## Steps

### S0 — Split verify into unit (every step) and e2e (milestones); re-take baseline
- status: done (7acca77)
- covers: Q3, Q4 (decisions)
- executor: sonnet
- risk: low
- files: `scripts/upgrade-verify.sh`, `upgrade/baseline.md` (new), `upgrade/HANDOFF.md`
- change:
  - `scripts/upgrade-verify.sh <label>`: replace the `test` check with `test:unit` (`pnpm run test:unit`), log `test-unit.log`. Keep typecheck, lint, build.
  - Add an optional second argument `--e2e`. With it, also run `pnpm run test:e2e` after build, with low parallelism (`--maxWorkers=1`, or `--no-file-parallelism` if the vitest version needs it) and `NODE_OPTIONS=--max-old-space-size=4096` (same heap as CI, D147). Log to `e2e.log` and add it to SUMMARY.md. Do not skip, exclude or retry tests.
  - Re-take the baseline twice on current HEAD (no dependency change): `scripts/upgrade-verify.sh baseline-r1 --e2e` then `baseline-r2 --e2e`.
  - Write `upgrade/baseline.md`. It holds both SUMMARY tables, the failing tests in both runs (stable failure), the ones failing in only one run (flaky), and worker crashes. Two known items:
    - Q4: `server/tests/routes.test.ts > cafe routes (D140) > routes outside a cafe's address never act in one`. Read the test and explain in 2–4 lines which route file(s) make the deep-equal differ. Do not fix it. Rule: it must not get worse (same diff).
    - The worker crash (exit 3221225477) in `server/features/menu/tests/promotions.service.test.ts`: stable or flaky.
  - HANDOFF: point "Baseline" to `upgrade/baseline.md` as the comparison source from now on.
- verify: `scripts/upgrade-verify.sh S0` (unit mode must run and match baseline-r1/r2)
- done when: the script supports both modes; `upgrade/baseline.md` lists stable/flaky failures from two e2e runs and explains the Q4 failure.

### S1 — Capture pre-upgrade runtime and theme evidence
- status: done (21de679)
- covers: C14, C15, C17, C21 (evidence only)
- executor: sonnet
- risk: low
- files: `upgrade/evidence/before/**` (new), `upgrade/HANDOFF.md`
- change: no source change. On current versions:
  1. `pnpm build:staging`. Copy `.output/server/wrangler.json` to `upgrade/evidence/before/wrangler.json` after removing any secret values (it should hold bindings and vars names only; check it). Note the `main` entry and that the wrapper from `server/cloudflare-entry.ts` is in the output.
  2. `pnpm build`. Start the built server the way `test/e2e/support/global-setup.ts` does (read it; use a fresh hub dir). Record status, response headers (security headers, request-id, cache-control) and body *shape* (keys, not data) in `upgrade/evidence/before/http.md` for:
     - (a) an unknown page under `/c/<seed slug>/`;
     - (b) an unknown `/api/c/<seed slug>/...`;
     - (c) an unauthenticated `/api/c/<seed slug>/admin/...` GET;
     - (d) an SSR page that redirects (any `sendRedirect`/`navigateTo` path from middleware 30/31), including a query with percent-encoded characters; record the `Location` header exactly;
     - (e) an unknown `/table/<bad token>`.
  3. Copy the generated Nuxt UI theme files (`.nuxt/ui/*.ts`; confirm the path) for components overridden in `app/app.config.ts` or via `:ui` (inventory §2) to `upgrade/evidence/before/ui-theme/`.
- verify: `scripts/upgrade-verify.sh S1`
- done when: `upgrade/evidence/before/` holds `wrangler.json` (no secrets), `http.md` with 5 cases, and the theme snapshot; committed.

### S2 — Bump nuxt to 4.6.1 with vue-router ^5.4.0
- status: done (2683e62)
- covers: C3; confirms no-ops C2, C5, C8, C9, C10, C13, C16, C18, C19, C34, C35, C36
- executor: sonnet
- risk: high (dependency change reaching server behavior, auth redirects and the data layer)
- files: `package.json`, `pnpm-lock.yaml`
- change: `pnpm add nuxt@^4.6.1 vue-router@^5.4.0` (ranges in package.json become `^4.6.1` / `^5.4.0`). Must be one step: nuxt 4.6.1 depends on vue-router ^5.4.0 and a split would leave two router copies. No code change. No `nuxt upgrade`, no `pnpm dedupe`. If install is refused by the release-age policy, stop and follow Q5. Then check and record in HANDOFF:
  - `pnpm why vue-router`, `pnpm why @nuxt/kit`, `pnpm why h3`, `pnpm why nitropack`. Expect one copy each (h3 1.15.11, nitropack 2.13.x). A second copy of vue-router or @nuxt/kit is a failure to investigate, not to dedupe blindly.
  - `@nuxt/cli` resolved to 4.x, and `nuxt prepare` (postinstall) succeeded.
- verify: `scripts/upgrade-verify.sh S2 --e2e` (milestone 1), compared with `upgrade/baseline.md`
- done when: install succeeds; lint, test:unit, build and e2e show no new failures vs baseline. Typecheck passes, or its only new errors are `$fetch`/`Serialize` typing errors (C11), listed in HANDOFF for S3.

### S3 — Fix typed `$fetch` / `Serialize` errors (only if S2 typecheck has new errors)
- status: done (9166d88)
- covers: C11
- executor: sonnet
- risk: high (sites include `useAuth.ts`, `usePlatformSession.ts`, `useCounterSession.ts`, i.e. the session/auth area)
- files: only files reported by typecheck; expected among `app/composables/useAuth.ts`, `useCounterSession.ts`, `useCustomerAccount.ts`, `usePlatformSession.ts`, `app/plugins/errors.ts`, `app/utils/api.ts`, `app/composables/useApiQuery.ts`
- change: make types explicit (generic argument or declared response type from `#shared`) so the inferred types match what the server returns. Runtime code is unchanged. No `any`, no casts that hide a mismatch, no `@ts-ignore`. If a mismatch shows a real wrong type in the app, record it and mark the step `blocked`.
- verify: `scripts/upgrade-verify.sh S3`
- done when: typecheck passes. If S2 had no new type errors, set `status: done` with the note "no change needed" in HANDOFF and make no commit.

### S4 — Check server runtime, errors and Cloudflare entry after the Nuxt bump
- status: done (5cf788a)
- covers: C7, C15, C17, C18
- executor: sonnet
- risk: high
- files: `upgrade/evidence/after-nuxt/**`, `upgrade/HANDOFF.md`; fix only if needed: `nuxt.config.ts` (nitro block / hooks), `server/error-handler.ts`, `app/error.vue`
- change: repeat S1 items 1–2 on the new version into `upgrade/evidence/after-nuxt/` and diff against `before/`:
  - `wrangler.json`: same bindings (D1, R2 `BLOB`, 3 ratelimits), crons, vars names, and `main` still runs through the `server/cloudflare-entry.ts` wrapper.
  - HTTP cases (a)–(e): same status, same security headers and request-id, same error body shape. A missing security header on an error render (C15: no second pass through middleware/route rules) is a failure.
  - Build log: no `nitro.*` deprecation warning (C7) and no template-compile failure (C18).
  Allowed fixes: move a deprecated `nitro.*` option to the top-level equivalent that Nuxt names (C7). If needed, apply headers/request-id to error renders in `server/error-handler.ts` (C15), with a server test that fails without the fix. Anything else → `blocked` + Plan issue.
- verify: `scripts/upgrade-verify.sh S4` (+ `pnpm build:staging`)
- done when: the evidence diff is empty or each difference is explained and accepted in HANDOFF; any fix has a failing-without-fix test.

### S5 — Check `useApiQuery` against Nuxt 4.6 `useAsyncData`
- status: done (30272a8)
- covers: C12
- executor: sonnet
- risk: high (every app read; identity-bound data clearing on session transitions)
- files: read: `app/composables/useApiQuery.ts`, `app/utils/invalidate.ts`, `app/plugins/session-boundary.client.ts`, `node_modules/nuxt/dist/app/composables/asyncData.js` (4.6.1); fix only if needed in those three app files and their tests
- change: compare the Nuxt 4.5 watch-path workaround described in `useApiQuery.ts:4-46` with the 4.6.1 source: #36124 hydration, #36301 lazy resolve, #36436 entry removal. Also check that `refreshNuxtData`/`clearNuxtData` + the payload key filter in `invalidate.ts:69` still clear identity-bound entries, and that stale in-flight responses are still discarded. Run the existing unit tests for these files and the e2e files for session transitions/sign-out and stale responses. Change code only if a test or a source read proves the workaround now conflicts. A workaround that is merely redundant stays (see Q6). A fix needs a test that fails without it.
- verify: `scripts/upgrade-verify.sh S5` + the e2e files named above
- done when: HANDOFF records, per fix (#36124/#36301/#36436), "no effect" or "fixed in <file>, test <name>"; session-transition e2e green.

### S6 — Check auth redirects and router behavior after the Nuxt bump
- status: done (HASH)
- covers: C14, C4, C6
- executor: sonnet
- risk: high (authentication redirect flow)
- files: read: `app/middleware/{auth,counter,platform}.global.ts`, `app/plugins/api.ts`, `app/plugins/auth-sync.client.ts`; fix only if needed there
- change: compare case (d) `Location` from S4 with S1 (must be byte-identical, or the difference must be a correct encoding that still round-trips). Run the e2e files for sign-in redirect / expired session / unauthorized access (staff, counter, platform). Check that a return path with a percent-encoded query survives sign-in. For C4, run the menu and orders e2e files (scroll spy, category bar) and check one in-page hash link manually (added to the checklist). Fix only a proven break, with a test. Never relax a redirect guard (open-redirect checks stay).
- verify: `scripts/upgrade-verify.sh S6` + the e2e files named above
- done when: redirect round trip proven by e2e + evidence; HANDOFF notes C4/C6 result.

### S7 — Bump @nuxt/ui to 4.12.0
- status: todo
- covers: C1, C20–C33 (bump only)
- executor: sonnet
- risk: medium
- files: `package.json`, `pnpm-lock.yaml`
- change: `pnpm add @nuxt/ui@^4.12.0`. No code change. Leave `modules/reka-namespaced.ts` and its unit test untouched (Q1). Check `pnpm why reka-ui` and `pnpm why tailwindcss` for one copy. If release age blocks the install → Q5.
- verify: `scripts/upgrade-verify.sh S7 --e2e` (milestone 2); `test/e2e/shop-menu.test.ts` must pass (Q1, D123 guard at :82)
- done when: no new failures vs baseline. If `shop-menu.test.ts:82` fails, mark `blocked` and add a Plan issue ("adapt reka-namespaced for by-name imports"). Do not change the test.

### S8 — Check forms: state types, dirty, exposed API
- status: todo
- covers: C22
- executor: sonnet
- risk: medium
- files: read: `app/composables/useFormErrorRecheck.ts`, `app/composables/useUnsavedChanges.ts`, `app/components/TaskFrame.vue`, `node_modules/@nuxt/ui/dist/runtime/components/Form.vue` (4.12.0 `defineExpose`); fix only if needed there
- change: confirm that `getErrors`/`validate` and the props `useFormErrorRecheck` reads still exist with the same signatures. Confirm that `dirty` timing (#7033, #6545) does not make the unsaved-changes prompt or form drafts fire wrongly. Run the form/draft/unsaved-changes unit tests and e2e files. Fix only proven breaks, with a test.
- verify: `scripts/upgrade-verify.sh S8` + form e2e files
- done when: HANDOFF notes "no change" or the fix + test.

### S9 — Check overlays, drawer, slideover and toasts
- status: todo
- covers: C24, C25, C27, C28
- executor: sonnet
- risk: medium
- files: read: `app/composables/useConfirm.ts`, `layouts/default.vue`, the ~16 `useOverlay().create` sites, `app/components/AppDrawer.vue`, `OptionSetEditor.vue:1058`, `ProductFormSlideover.vue:1165`, `useMutation.ts`, `useNotify.ts`, `plugins/session-boundary.client.ts`; fix only if needed
- change: find any overlay instance reopened while an earlier `open()` promise is pending (C27: now all pending promises resolve). If one exists, check that the caller handles the earlier resolution. Check that a slideover's inline `sm:max-w-*` still applies (C25). Check that the first toast after a session boundary or while offline still shows, now that the Toaster is lazy (C28). Run confirm/unsaved/option-set/product e2e files. Fix only proven breaks, with a test.
- verify: `scripts/upgrade-verify.sh S9` + related e2e files
- done when: HANDOFF notes per C-item.

### S10 — Check selects and accessibility labels
- status: todo
- covers: C23, C29
- executor: sonnet
- risk: low
- files: read: `app/components/RecordSelect.vue`, `BranchSettingsTab.vue`, `CafeFormModal.vue`, `ListPagination.vue`; e2e/a11y tests; fix only if needed
- change: run the e2e files that use these pickers and the axe-core a11y tests. If a test pinned an old default aria-label that Nuxt UI changed (C29), update the expectation to the new accessible name. The assertion must stay as strict (do not drop it or loosen it to a regex wildcard). Fix focus/open regressions in `RecordSelect` only if a test proves them.
- verify: `scripts/upgrade-verify.sh S10` + those e2e files
- done when: those e2e and a11y tests are green with no assertion weakened.

### S11 — Check theme overrides against the 4.12 theme
- status: todo
- covers: C20, C21
- executor: sonnet
- risk: medium
- files: `upgrade/evidence/after-ui/ui-theme/`; fix only if needed: `app/app.config.ts`, the specific `.vue` `:ui` overrides, `app/assets/css/tailwind.css`
- change: diff the generated theme files against `upgrade/evidence/before/ui-theme/`. For every removed or changed class in a slot this app overrides (app.config list + inline `:ui` slot keys from inventory §2), decide whether the override still wins (tailwind-merge) and still makes sense. Fix the override only when the visual result changed unintentionally. Check `tailwind.css` `.light`/`.dark` token overrides and `@media print` with the new `@custom-variant` (C20). Use semantic tokens only.
- verify: `scripts/upgrade-verify.sh S11`
- done when: each relevant theme diff entry is marked "no effect" or "fixed" in HANDOFF; light, dark and print checks are added to the manual list.

### S12 — Final verify and progress note
- status: todo
- covers: all
- executor: sonnet
- risk: low
- files: `docs/progress.md`, `upgrade/HANDOFF.md`
- change: run the final milestone. Add a short progress entry: Nuxt 4.6.1 / Nuxt UI 4.12.0. Follow-ups: the reka-namespaced module is a no-op after 4.12.0 (Q1, D123); the Q4 routes test investigation. Fill HANDOFF "Manual tests to do" from this plan's checklist plus every risk: high step.
- verify: `scripts/upgrade-verify.sh final --e2e` (milestone 3) + `pnpm build:staging`
- done when: no new failures vs `upgrade/baseline.md`; Q4 test diff unchanged; HANDOFF ready for Phase 5.

## Manual test checklist
Profile smoke test:
- [ ] login, logout
- [ ] session refresh; expired session → redirect to sign-in and back to the original page (with an encoded query in the URL) (C14)
- [ ] one protected route as an unauthorized user (staff, counter, platform)
- [ ] one CRUD flow
- [ ] one stale edit → 409 with Reload
- [ ] main dashboard pages
- [ ] one form with validation
- [ ] dark mode

Specific to this upgrade:
- [ ] Switch user/cafe: no data from the previous identity shows, and in-flight responses are discarded (C12)
- [ ] 404 page and a forced 500: page renders, security headers present (C15)
- [ ] Unsaved-changes prompt: appears after typing, not on open; confirm dialog cancel/confirm (C22, C27)
- [ ] Searchable RecordSelect: type, keyboard select, focus stays, closes correctly on touch (C23)
- [ ] AppDrawer on phone width; both slideovers at phone and tablet width (C24, C25)
- [ ] First toast after sign-in, and a toast while offline (C28)
- [ ] Admin sidebar menu and search palette (Ctrl/Cmd+K) open on first use (C28)
- [ ] Customer menu: scroll spy, category bar, one in-page hash link; back/forward restores position (C4)
- [ ] Light, dark and print views of an admin page and the customer menu (C20, C21)
- [ ] Assistant panel chat send (C29, C32)
- [ ] After merge: staging deploy succeeds and a staging request works end to end (C17)

## Open questions (must be answered before execution)
- Q5: pnpm's `minimumReleaseAge` is active (pnpm 12 default; only `@nuxtjs/better-auth@0.3.5` excluded). @nuxt/ui 4.12.0 was published 2026-10-15T13:01Z, and nuxt 4.6.1's new transitive deps may also be recent. If an install is refused: wait until it ages (recommended; keeps the supply-chain policy), or add temporary `minimumReleaseAgeExclude` entries and remove them later?
- Q6: If S5 shows the Nuxt 4.5 watch-path workaround in `useApiQuery.ts` is now redundant but harmless: keep it in this run and record a follow-up (recommended), or remove it here (more risk in the data layer)?
- Q7: C17 can only be fully proven by a real Cloudflare deploy, and RULES forbid deploys. Is "staging build + `wrangler.json` diff before merge, then the automatic staging deploy from main after merge" enough (recommended)?

## Not in scope
- `@nuxtjs/better-auth` 0.3.5 → 0.3.10 (Q2), any Better Auth config change.
- Removing `modules/reka-namespaced.ts`, its unit test or D123 docs (Q1).
- Fixing the Q4 routes test (separate tenant-isolation investigation).
- Other dependency bumps (`@nuxt/test-utils` 4.3.3, h3, nitropack, drizzle, wrangler, eslint), `nuxt upgrade --dedupe`, `pnpm dedupe`.
- Opt-in Nuxt 4.6 features and Nuxt 5 compatibility flags (C8, C11 `routeTypedFetch`, C34, C35); new Nuxt UI features (C31 `UChart`, C33 additive props).
- Deploying (staging or production).
