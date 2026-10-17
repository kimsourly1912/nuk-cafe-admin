# Upgrade handoff — nuxt-ui-latest

> Single source of truth between sessions for THIS upgrade run.
> Every session reads this first and updates it before it ends.
> Created from `.claude/upgrade/HANDOFF.template.md` by `/upgrade-0-setup`.

Run: nuxt-ui-latest
Targets: nuxt@latest @nuxt/ui@latest
Branch: chore/upgrade-nuxt-ui-latest
Package manager: pnpm (12.3.4, from lockfile + packageManager)
Started: 2026-10-16

Current phase: 4 (execute), S0-S12 done (execute finished)
Next: /upgrade-5-review in a new Opus session. Compare with `upgrade/baseline.md`.

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
  - REVISED 2026-10-17 (owner): retire it in S7. Nuxt UI 4.12.0 (and vaul-vue, the only other Reka UI user) has no `reka-ui/namespaced` import, so the module is a no-op and its unit test failed (0 families). D123 already said "remove it when Nuxt UI imports Reka UI by name". The shop-menu e2e guard stays.
Q2: Bump @nuxtjs/better-auth to 0.3.10? — No. Separate upgrade run later. — decided 2026-10-16
Q3: Reliable e2e baseline? — Plan step S0 before any dependency change: split unit/server tests (every step) from e2e (milestones only: after nuxt bump, after nuxt-ui bump, final), run e2e serially or with low maxWorkers, re-take the baseline twice and mark flaky tests. — decided 2026-10-16
Q4: Failing "routes outside a cafe's address never act in one" — Not accepted as a normal baseline failure. Investigate separately (tenant isolation). Record it as a known, explained failure in baseline.md; it must not get worse. — decided 2026-10-16
Q5: @nuxt/ui 4.12.0 below pnpm minimum-release-age — Wait; no exclusions (supply-chain protection stays on). Prep steps (S0 etc.) proceed now; the bump step waits. The bump step must report any transitive packages refused by the age rule. — decided 2026-10-16
Q6: Nuxt 4.5 workaround in useApiQuery — Keep and log a follow-up, ONLY if proven harmless on 4.6: useApiQuery tests pass AND request count / refresh behavior unchanged (test or manual network check). If not harmless, fix in this run. — decided 2026-10-16
Q7: Proving the Cloudflare entry (C17) — Before merge: staging build + wrangler.json diff + `wrangler deploy --dry-run` + local `wrangler dev` smoke test (login, one D1-backed API call). After merge: smoke-test the staging deploy before production; rollback = wrangler rollback. Claude does not deploy. — decided 2026-10-16

## Done

S0: verify script split (test:unit every step, `--e2e` at milestones, 1 worker, 4 GB heap). Baseline retaken twice in `upgrade/baseline.md` (comparison source from now on): serial e2e is green (46 files / 566 tests) except one flaky test; the Q4 test fails only on Windows path separators.

S1: pre-upgrade evidence in `upgrade/evidence/before/`: `wrangler.json` (database_id redacted; main = index.mjs, re-exports the cloudflare-entry wrapper, see entry.txt), `http.md` (cases a, b, c, d, d2, e), `ui-theme/*.ts.txt` (all 118 generated theme files; renamed .txt so lint ignores them), `build-warnings.txt`. Capture script `upgrade/evidence/capture-http.test.ts.txt` (reuse in S4: copy to test/e2e/zz-capture-http.test.ts, `CAPTURE_LABEL=after-nuxt pnpm vitest run --project e2e zz-capture-http`, delete the copy).
  - Case (d) note for S4/S6: the `Location` header exists only for old addresses (`/admin/orders?...` -> 302 `/c/nuk/admin/orders?...`, encoded query kept byte for byte). The auth redirect (middleware `auth.global.ts`) is client-side: SSR of an unauthenticated `/c/nuk/admin/...` is 200 (case d2), so C14 must be proven by e2e, not by a Location header.
  - S1 verify: typecheck/lint/build PASS; test:unit only the known Q4 failure (separator diff unchanged). Unit counts (1474 passed) are higher than baseline (1466) because HEAD `4154474` added tests after the baseline commit.

S2: nuxt 4.6.1 + vue-router 5.4.0 installed (no release-age refusal). `pnpm why`: one vue-router (5.4.0), nitropack 2.13.4, h3 1.15.11, @nuxt/cli 4.0.1. Verify: lint PASS, build PASS, test:unit only the known Q4 failure, e2e 46 files / 566 tests PASS (1401s). Typecheck: one new error, `app/utils/api.ts:41` (TS2769, `useRequestFetch` typed overload, C11) -> S3.
  - Finding: @nuxt/kit now has copies 3.21.11 (was already there), 4.5.2 and 4.6.1. nuxt itself uses 4.6.1; modules (@nuxt/ui, @nuxthub/core, @nuxtjs/better-auth, @nuxt/devtools, @dxup/nuxt, color-mode, icon, fonts) keep resolving 4.5.2 through their peer ranges (pnpm reuses the locked version). Not deduped (plan). Build and e2e are green; revisit if S4 finds module-hook problems.
  - Env note: stale e2e processes from a killed session hold `.data/e2e/db` (EPERM on rmSync); kill vitest/.output server processes before rerunning e2e.

S3: fixed the only new type error (`app/utils/api.ts` serverFetch, C11): `Parameters<typeof fetch>[1]` now resolves to the wrong overload of Nuxt 4.6's `TypedFetch`; the call names `fetch<T, string, AnyServerRouteMethod>` and casts the options to `TypedFetchOptions<string, AnyServerRouteMethod>` (both from `#app`). Runtime unchanged. Typecheck/lint/build PASS; test:unit = Q4 failure only, plus the known flaky Windows worker crash (exit 3221225477) which hit `modifiers.service.test.ts` this time (passes alone, 17 tests).

S4: evidence in `upgrade/evidence/after-nuxt/` (wrangler.json, http.md, build-warnings.txt). `wrangler.json` identical to before (D1, R2 BLOB, 3 ratelimits, crons, vars, main = index.mjs still re-exporting the cloudflare-entry wrapper; `boundedWorkerRequest` bundled). HTTP cases a-e + d2: same status, same security headers and request-id, same error body shapes, same 302 Location in (d). Only difference, accepted: case (a) (404 page render) now has `vary: accept, sec-fetch-mode`, added by Nuxt 4.6's own error handler (`@nuxt/nitro-server/dist/runtime/handlers/error.mjs`) for content negotiation; harmless. Build log: no `nitro.*` deprecation (C7), no template-compile failure (C18); only the same 4 reka-namespaced SOURCEMAP_BROKEN warnings and PLUGIN_TIMINGS (times differ). No code change.
  - Verify S4: typecheck/lint/build PASS; test:unit = Q4 failure only + the known flaky Windows worker crash (3221225477), now on `notifications.delivery.test.ts` (4 files / 58 tests pass alone). The crash lands on a different file each run, so it is environmental, not caused by the upgrade.

S5 (C12, `useApiQuery` vs Nuxt 4.6.1 `useAsyncData`; read `node_modules/nuxt/dist/app/composables/asyncData.js`, no code change):
  - Watch workaround (Q6): NOT redundant. 4.6.1's params watcher still calls `debounceTick`'d `_execute`, which returns the running promise while a request is in flight (`debounce-tick.js`: `if (currentPromise) return currentPromise`), so the 4.5 problem (a slow older search blocks the newer one) is unchanged. Workaround stays as is.
  - D150 "keep data on failure": 4.6.1 failure path still sets `error` first, then resets `data` (asyncData.js:418-419), so the sync `rawError` watcher + `justFailed` logic still works. `clearNuxtDataByKey` now resets `data` before `error` (the old comment says clear dropped the error first), but `justFailed` is already false by then (a restored or unchanged data watcher clears it), so a clear cannot put old data back. The code comment says it does not rely on the order. Comment is accurate as is.
  - #36124 / #36301 (awaited useAsyncData): no effect; no call site awaits `useApiQuery`/`useAsyncData`. #36436 (entry removal on key change): no effect found; `useApiQuery` keys are stable per call, and the full e2e (566 tests, S2) ran on 4.6.1.
  - `invalidate.ts`/`session-boundary.client.ts`: still correct. `payload.data` keys are filled on success as before, `clearNuxtData` keeps `_asyncData` entries (resets value, error, status), `refreshNuxtData` still calls the `app:data:refresh` hook.
  - Tests: no unit test covers `useApiQuery` itself (gap, not added: no change made). E2E on 4.6.1 PASS: session, list-page, form-drafts, counter-orders-api (4 files / 35 tests; stale response and session-transition cases are in session.test.ts, list-page.test.ts). Source tree unchanged since the S4 verify (typecheck/lint/build PASS).
  - Follow-up for the final summary: none required; keep the workaround.

S6 (C14, C4, C6; no app code change):
  - Case (d) Location byte-identical before/after the Nuxt bump (S4 evidence). The auth/counter/platform redirects are client-side middleware (`navigateTo` with `query: { redirect: to.fullPath }`); no open-redirect guard touched (`loginRedirectTarget` unchanged).
  - New e2e test `test/e2e/auth.test.ts > keeps a percent-encoded query through the sign-in round trip`: a logged-out visit to `/c/nuk/admin/categories?q=caf%C3%A9%20au%20lait&tag=a%26b` goes to login with `redirect` holding the same values, and after sign-in lands on the page with `q=café au lait`, `tag=a&b`. Note: vue-router writes a space in a query as `+` (`encodeQueryValue` is identical in 5.3.1 and 5.4.0), so the test compares decoded values, not spelling. Not a regression.
  - E2E on 4.6.1 PASS: auth, counter, platform, password, session, shop-menu, shop-orders*, shop-tracking, your-cafes (9 files, 110 tests incl. the new one). C4 (scroll spy/category bar in shop-menu) green; the in-page hash link, back/forward position still on the manual list. C6 confirmed no `/api`//`media` link targets (plan).
  - Verify S6: typecheck/lint/build PASS; test:unit Q4 failure only (1474 passed).

S7 (@nuxt/ui 4.12.0, bump in `4e05df3`; Reka module retired per revised Q1):
  - Install: no release-age refusal (Q5). One reka-ui (2.11.0, used only by @nuxt/ui and vaul-vue), one tailwindcss (4.3.3). Bump-only verify (`upgrade/logs/S7/`): typecheck/lint/build PASS; unit = Q4 + the reka-namespaced test (0 families); e2e serial: products and modifier-groups D166 load flakes in the full run, both pass alone (products 60/60; modifier-groups + shop-menu 69/69).
  - Retirement: no file in Nuxt UI 4.12.0 or vaul-vue imports `reka-ui/namespaced` (grep of the installed dist), so the plugin was a no-op. Deleted `modules/reka-namespaced.ts` (the `modules/` folder is now gone) and `test/unit/reka-namespaced.test.ts`; amended D123 ("Removed") and `docs/guides/development.md`. `docs/progress.md` 10.8 left as history.
  - Verify S7a (`upgrade/logs/S7a/`): typecheck/lint PASS. Build first FAILED on the local dev DB, unrelated: `.data/db/sqlite.db` had been replaced by an old 2026-09-27 copy (10 migrations under the old numbering, `0009_branch_item_states`; the S7 build that morning saw 40), so 0010 hit "table already exists". Build against a fresh DB (old one moved aside, then restored) PASS, and the 4 reka-namespaced SOURCEMAP_BROKEN warnings are gone. Unit: 1466 passed, 4 failed = Q4 + three 5 s timeouts under load (migrations 0029, d1-limits, health); those 3 files pass alone (30/30). E2E `shop-menu.test.ts` 28/28 incl. the D123 guard.
  - Env: the old local DB is still at `.data/db` (owner to reset it or restore a good copy); the fresh build DB is kept at `.data/db-fresh-build`.

S8 (C22, forms; no code change):
  - `UForm` 4.12.0 still exposes what the app reads: `getErrors()`, `validate({ name: string[], silent: true })` (same `_validate`, names matched by `nameMatcher`), and the props `schema`/`state` via `$props` (`useFormErrorRecheck.ts`). `TaskFrame.vue` only documents the `id`/`form=` pattern and calls no form API.
  - Dirty (#7033, #6545): no effect. The app never reads `UForm`'s `dirty`/`dirtyFields`/`@update:dirty`; unsaved state is its own `useUnsavedChanges` (`isSameFormValue` against a baseline). #7165 (state type) gave no typecheck error.
  - Tests PASS on 4.12.0: unit form-draft + form-value (14); e2e unsaved-changes, form-drafts, modifier-groups, option-sets, products, categories (6 files / 186 tests, serial). Verify S8 (`upgrade/logs/S8/`): typecheck/lint/build PASS; test:unit = Q4 failure only (1469 passed).
  - Env fix: `.data/db` was the stale 2026-09-27 copy (migration 0010 failed the build). Renamed it to `.data/db-stale-2026-09-27` and moved the fresh build DB to `.data/db`. Nothing deleted; the owner can drop the stale folder.

S9 (C24, C25, C27, C28; one fix):
  - C25 FIXED: Nuxt UI 4.12's slideover theme sets `sm:max-w-md` (was `max-w-md`). `ProductFormSlideover.vue` overrode with unprefixed `max-w-2xl`, which tailwind-merge no longer treats as a conflict, so from `sm` the panel shrank from 672px to 448px. Changed to `sm:max-w-2xl` (`ProductFormSlideover.vue:83`). Test `test/e2e/products.test.ts > the slide-over is as wide as max-w-2xl from sm`: width 672px at 1280, 390px at phone width. Fails without the fix (448 vs 672, run before the change), passes with it. `OptionSetEditor` only uses the default width (448px from sm, full width below; same on desktop).
  - C27: no code change. `useOverlay` 4.12 keeps a `resolvers` list and `close()` resolves all of them with the same value; before, a second `open()` replaced the first resolver and left that promise pending forever. Every `useConfirm`/restore/photo/product/staff/category/platform open uses a fresh `destroyOnClose` instance, so nothing is reopened. Reused instances whose result is awaited (`ModifierGroupListPage.create`, `ModifierGroupPage.openAddOn`, `OptionSetListPage.create`, `PromotionEditorPage.chooseTargets`, `KhqrSettingsCard.openTokenModal`) could only resolve twice after a double open before the modal covers the page; each handler is idempotent (same navigation, same state assignment, `testResult = null`), so a double resolve is harmless, and the old hanging promise is gone.
  - C24: no effect. `AppDrawer.vue` passes neither `noBodyStyles` nor `after:*` listeners (none in `app/`).
  - C28: no code change. The toast list is `useState('toasts')` and `Toaster` renders from it, so a toast added before the lazy item loads is still shown; `useNotify`/`useMutation` only call `toast.add`. Admin sidebar, search palette and offline toast stay on the manual list.
  - E2E on 4.12.0 PASS (8 files / 131 tests, serial, incl. the new one): products, option-sets, unsaved-changes, app-shell, admin-search, shortcuts, session, ui-foundations. Verify S9 (`upgrade/logs/S9/`): typecheck/lint/build PASS; test:unit = Q4 failure only (1469 passed).

S10 (C23, C29; no change):
  - E2E on 4.12.0 PASS, serial: accessibility (axe-core), assistant, availability-rules, branches, color-mode, list-bulk, list-page, pickers, cafes, platform, staff, shop-checkout, shop-menu (14 files / 188 tests). S8/S9 e2e already covered categories, option-sets, products, modifier-groups (pickers inside forms). No test pinned a default aria-label that Nuxt UI 4.12 changed, so no expectation was touched and none was loosened. `RecordSelect`/`BranchSettingsTab`/`CafeFormModal`/`ListPagination` unchanged.
  - Source tree unchanged since the S9 verify (typecheck/lint/build PASS, test:unit Q4 failure only), so no new verify run.

S11 (C20, C21; no change): generated theme saved in `upgrade/evidence/after-ui/ui-theme/` (119 files, `.txt`; `chart.ts` is new). `before/` has CRLF line endings, so the diff ignores them (`diff --strip-trailing-cr`): 16 files differ in content. Only components the app overrides or uses matter:
  - `slideover` (`app.config` overlay slot; `content` max-w): FIXED in S9 for `ProductFormSlideover`. The `overlay` override is not touched.
  - `checkbox`, `radioGroup` (`app.config` `base`/`indicator` slots, `max-sm:` hit areas; inline `:ui` `root`/`fieldset`/`item` paddings and flex): the theme only added `not-has-aria-disabled` to hover/checked variants and raised the checked radio `z-[1]`→`z-[2]`. No overridden class conflicts: no effect.
  - `table` (`ItemSalesPage` `tfoot: 'font-semibold text-highlighted'`): the base `tfoot` gains `[&>[data-slot=separator]]:z-2`; no conflict: no effect.
  - `select`, `selectMenu` `content`: adds `data-[state=closed]:pointer-events-none!`; no app override of `content`: no effect.
  - `separator` (17 uses): drops the no-op `align-center` from `root`: no effect.
  - `sidebar` (`AssistantPanel`, `:ui body/footer`): breakpoint classes move into a new `breakpoint` variant whose prop default is `lg`, the old fixed value; the overridden slots `body`/`footer` are unchanged: no effect. Assistant e2e PASS (S10).
  - Not used in the app (so no effect): `editor`, `inputTags`, `marquee`, `pageColumns`, `stepper`, `toaster` (internal data attributes only; no `toaster` override), `chart` (new, C31).
  - `dashboardNavbar/Panel/Toolbar`, `tabs`, `card`, `switch`, `modal`, `drawer` (the other `app.config` overrides): theme files identical, no effect.
  - C20: `tailwind.css` overrides `--ui-*` on `:root, .light`, `.dark` and in `@media print` (unlayered, over Nuxt UI's `@layer theme`). 4.12's `index.css` still declares tokens on `.light`/`.dark` in `@layer theme` and `@custom-variant light|dark (&:where(.light, .light *))`: same class strategy, so the overrides still win. `ui-foundations` (contrast), `color-mode` and `accessibility` e2e PASS (S9, S10). Light, dark and print still go on the manual list (already in the plan checklist).
  - Source tree unchanged since the S9 verify, so no new verify run.

## Manual tests to do

<!-- risk: high items from Phase 2 (S5 done: automated checks passed; the "switch user/cafe" item in the plan checklist still needs a human pass): C12 useApiQuery/useAsyncData, C14 navigateTo redirects, C15 error rendering, C17 Cloudflare entry/nitro hooks -->

Profile smoke test:
- [ ] login, logout
- [ ] session refresh; expired session → redirect to sign-in and back to the original page, with an encoded query in the URL (C14, S6)
- [ ] one protected route as an unauthorized user (staff, counter, platform)
- [ ] one CRUD flow
- [ ] one stale edit → 409 with Reload
- [ ] main dashboard pages
- [ ] one form with validation
- [ ] dark mode

Specific to this upgrade (risk: high steps S2–S6, plus S9 fix):
- [ ] Switch user/cafe: no data from the previous identity shows, and in-flight responses are discarded (C12, S5)
- [ ] 404 page and a forced 500: page renders, security headers present (C15, S4). Automated: only the 404 `vary: accept, sec-fetch-mode` difference was seen.
- [ ] Unsaved-changes prompt: appears after typing, not on open; confirm dialog cancel/confirm (C22, C27)
- [ ] Searchable RecordSelect: type, keyboard select, focus stays, closes correctly on touch (C23)
- [ ] AppDrawer on phone width; both slideovers at phone and tablet width. The menu item slide-over must be about 672px wide from `sm` (S9 fix, C24, C25)
- [ ] First toast after sign-in, and a toast while offline (C28)
- [ ] Admin sidebar menu and search palette (Ctrl/Cmd+K) open on first use (C28)
- [ ] Customer menu: scroll spy, category bar, one in-page hash link; back/forward restores position (C4)
- [ ] Light, dark and print views of an admin page and the customer menu (C20, C21, S11)
- [ ] Assistant panel chat send (C29, C32)
- [ ] After merge: staging deploy succeeds and a staging request works end to end (C17); before merge optionally `wrangler deploy --dry-run` and a local `wrangler dev` smoke test (Q7). The staging `wrangler.json` equals the `after-nuxt` evidence.

## S12 — final verify (milestone 3)

`scripts/upgrade-verify.sh final --e2e` (`upgrade/logs/final/`): typecheck/lint/build PASS, e2e PASS (46 files / 568 tests, serial, 907 s), `pnpm build:staging` PASS, `.output/server/wrangler.json` identical to `upgrade/evidence/after-nuxt/wrangler.json`. test:unit: the Q4 failure (same separator diff as S9) and the known flaky Windows worker crash (3221225477) in `staff.service.test.ts`, which passes alone (33 tests). No new failure vs `upgrade/baseline.md`. Progress entry added to `docs/progress.md`.
Follow-ups for the summary: Q4 test path separators; `@nuxtjs/better-auth` bump (Q2); owner may delete `.data/db-stale-2026-09-27`.
