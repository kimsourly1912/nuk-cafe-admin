# Upgrade review — nuxt-ui-latest
Base: `origin/main` (`56d576c`; local `main` is stale, so `main..HEAD` shows 306 commits) | Commits: 26 | Verify (final, `b78fb7d`): typecheck/lint/build PASS, e2e PASS (46 files / 568 tests, serial), `build:staging` PASS with `wrangler.json` identical to `after-nuxt`; test:unit FAIL = only the known Q4 separator failure + the known flaky Windows worker crash (3221225477, `staff.service.test.ts`, passes alone). No new failure vs `upgrade/baseline.md`.

Resolved versions (`package.json` + HANDOFF S2/S7): nuxt 4.6.1, @nuxt/ui 4.12.0, vue-router 5.4.0 (one copy), vue 3.5.43, nitropack 2.13.4, h3 1.15.11, reka-ui 2.11.0 (one copy), tailwindcss 4.3.3 (one copy), @nuxt/cli 4.0.1. @nuxt/kit has three copies (3.21.11, 4.5.2, 4.6.1), see O1.

Source changes made by the upgrade steps (outside `upgrade/`, `.claude/`, docs):
- `app/utils/api.ts:42` typed `serverFetch` call (S3, C11).
- `app/features/products/components/ProductFormSlideover.vue:83` `sm:max-w-2xl` (S9, C25) + e2e `products.test.ts`.
- `modules/reka-namespaced.ts` and `test/unit/reka-namespaced.test.ts` removed (S7, C1, revised Q1); e2e guard `shop-menu.test.ts:82` kept.
- New e2e `auth.test.ts` encoded-query round trip (S6, C14).
- `package.json`: nuxt ^4.6.1, @nuxt/ui ^4.12.0, vue-router ^5.4.0.

## Critical

None.

## Important

### R1 — Q7 pre-merge Cloudflare checks were downgraded to "optional" and not done
- where: `upgrade/HANDOFF.md:72` (Q7 decision) vs `upgrade/HANDOFF.md:165` (manual list)
- problem → the owner's Q7 decision says *before merge*: staging build + `wrangler.json` diff + `wrangler deploy --dry-run` + a local `wrangler dev` smoke test (login, one D1-backed API call). Only the build and the diff were done (S4, S12). The manual list now calls the dry-run and `wrangler dev` "optional". → why it matters: C17 (custom Cloudflare entry swapped in `nitro:init`, error handler prepended in `nitro:config`) is high-risk area 5/7 and is the one part not provable with the Node build; main deploys to staging automatically, so a broken Worker bundle would land on staging the moment the PR merges. → fix: run `wrangler deploy --dry-run --config .output/server/wrangler.json` on the `pnpm build:staging` output (no upload; confirms the bundle and bindings validate), and a local `wrangler dev --config .output/server/wrangler.json` smoke test: sign in, one D1-backed API call (for example the admin categories list), one 404 render. Record results in HANDOFF; restore the manual-list wording to "before merge (Q7)". No source change. If wrangler needs credentials or a remote binding to run, stop and hand both commands to the owner.
- executor: sonnet

### R2 — Unrelated feature commit `4154474 "new"` is on the upgrade branch
- where: commit `4154474` — `app/composables/useFormRowErrors.ts`, `app/utils/form-rows.ts`, `app/features/option-sets/components/OptionSetCreateModal.vue`, `app/features/modifier-groups/components/ModifierGroupCreateModal.vue`, `app/layouts/default.vue:16-38,71,86-96`, `app/app.config.ts:63` (`bg-black/50!`), D171 in `docs/decisions.md`, `docs/progress.md`, `docs/reference/{forms,ui}.md`, 2 unit test files
- problem → a non-upgrade change (D171 form-row errors, sidebar "centre the active link", hidden sidebar scrollbar, `!important` on the modal overlay) landed between S0 and S1 with a non-descriptive message. Its own progress entry says it was **not checked in a browser or e2e**. → why it matters: AGENTS.md "one step per branch/PR"; the upgrade PR would merge an unreviewed UI feature under an upgrade title, and a regression in it would be blamed on (or rolled back with) the upgrade. Note the upgrade's e2e run did include it (568 tests green), so it is not known to be broken, only unreviewed and out of scope. → fix: **owner decision first.** Either (a) keep it here and say so in the PR description (give it its own review and a browser check, see I1), or (b) move it to its own branch: create `fix/form-row-errors` from `origin/main`, `git cherry-pick 4154474`, push; then on this branch add a `git revert 4154474` commit (no reset/rebase, per RULES), re-run `scripts/upgrade-verify.sh R2` and the `products`, `option-sets`, `modifier-groups`, `app-shell` e2e files. Recommendation: (b).
- executor: sonnet (after the owner answers)

## Improvement

### I1 — `default.vue` sidebar centring vs the 4.12 lazy sidebar menu (only matters if R2 keeps `4154474`)
- where: `app/layouts/default.vue:38` (`watch(open, isOpen => isOpen && nextTick(revealActiveItem))`)
- Nuxt UI 4.12 renders the phone sidebar menu lazily (`useLazyOverlay` in `DashboardSidebar.vue:76`: the slideover is first rendered when `open` becomes true; C28). On the first open the nav may not be mounted one tick later, so `revealActiveItem` finds no visible link and silently does nothing. Harmless (no error), but the feature may not work on the first phone open. Manual check: phone width, open the menu on a page low in the list (Telegram) for the first time; the link should be centred. If not, wait for the slideover's `after:enter` instead of `nextTick`. Belongs to the D171/sidebar PR, not the upgrade.

### I2 — No unit test covers `useApiQuery` itself
- where: `app/composables/useApiQuery.ts` (S5 note)
- S5 proved the 4.5 watch workaround is still needed (4.6.1 `debounceTick` still returns the running promise) by reading source, and e2e covers it indirectly. A unit test for "a newer search is not blocked by a slow older one" would catch the next Nuxt change. Separate follow-up.

## Optional

- O1 — three `@nuxt/kit` copies (3.21.11, 4.5.2, 4.6.1); modules keep 4.5.2 through their peer ranges. Build and e2e are green. Consider a targeted `pnpm dedupe @nuxt/kit` in a later run, not here.
- O2 — Update local `main` (`git fetch` / fast-forward) so `main..HEAD` reflects the 26 real commits.
- O3 — `.data/db-stale-2026-09-27` is a stale local DB the owner can delete (local only, not in git).
- O4 — Q4 test (`routes.test.ts`, Windows path separators) and `@nuxtjs/better-auth` 0.3.10 (Q2) remain separate follow-ups, already in HANDOFF.

## Review notes by focus area

1. High-risk areas (profile order):
   1. Authentication: no change to Better Auth mounting, session lookup, cookies or origin checks; `@nuxtjs/better-auth`/`better-auth` versions unchanged. Redirect round trip covered by the new `auth.test.ts` test (S6) and the byte-identical case (d) `Location`.
   2. Authorization: no server route, middleware or policy file changed.
   3. Data scoping: no repository/service/query changed; no new table.
   4. Concurrency: no write path changed; 409 flow untouched (stale edit stays on the manual list).
   5. Server behavior: same status codes, headers, request-id and error shapes for cases a–e (S4); the only difference is Nuxt's own `vary: accept, sec-fetch-mode` on the 404 render, harmless. No `routeRules` change, no new `nitro.*` deprecation. Cloudflare entry: see R1.
   6. Runtime config: no `runtimeConfig`/`public` change; `wrangler.json` vars identical.
   7. Database: no migration or binding change; bindings identical in `wrangler.json`.
2. App behavior: `useApiQuery` workaround still required and kept (S5, Q6); `invalidate.ts`/`session-boundary.client.ts` still correct for 4.6.1; error page and middleware unchanged; NuxtLink fall-through (C6) not reachable (no `/api`//`media` links). `api.ts` cast replaces an equivalent earlier cast with the explicit 4.6 types (no `any`).
3. UI: forms API used by `useFormErrorRecheck` unchanged (S8); overlays/`useOverlay` double-resolve harmless (S9); slideover width fixed with a test that failed first (S9); theme diffs checked per overridden slot (S11); a11y/axe e2e green without loosened assertions (S10); light/dark token strategy unchanged (S11).
4. Hygiene: no `@ts-ignore`, `@ts-expect-error`, `any`, `eslint-disable`, `.skip`/`.only`, `console.log` or `debugger` in changed source/test files; no compatibility or `future` flags added; no opt-in 4.6 features. Unrelated change: R2.
5. Coverage: below, every `affected: yes` and `unknown` item is handled by a done step.

## Breaking-change coverage
| ID | Handled by | OK? |
|---|---|---|
| C1 Reka by name | S7 (module retired, D123 amended, e2e guard kept and green) | yes |
| C3 vue-router ^5.4.0 | S2 (one copy 5.4.0) | yes |
| C4 router scroll (unknown) | S6 (shop-menu e2e) + manual list | yes, manual part open |
| C6 NuxtLink fall-through (unknown) | plan facts + S6 | yes |
| C11 typed `$fetch` (unknown) | S3 (`api.ts`) | yes |
| C12 useAsyncData | S5 | yes |
| C14 navigateTo encoding | S6 (+ new e2e) | yes |
| C15 error rendering | S4 | yes, 500 render on manual list |
| C17 Nitro/Cloudflare (unknown) | S4, S12 (build + `wrangler.json` diff), R1 (dry-run + local `wrangler dev` smoke) | yes (deployed Worker: after merge) |
| C20 `@custom-variant` light/dark | S11 | yes, manual visual open |
| C21 theme class cleanup (unknown) | S11 (+ S9 fix) | yes |
| C22 Form | S8 | yes |
| C23 SelectMenu | S10 | yes, touch check on manual list |
| C24 Drawer | S9 | yes |
| C25 Slideover width | S9 (fix + test) | yes |
| C27 useOverlay | S9 | yes |
| C28 lazy overlays/toaster | S9 | yes, manual list; see I1 |
| C29 a11y labels | S10 | yes |

## Manual test checklist (final)

Before merge:
- [x] R1: `wrangler deploy --dry-run` on the staging build and a local `wrangler dev` smoke test (sign in, one D1-backed API call, one 404) (Q7, C17)
- [x] R2: moved to `fix/form-row-errors` and reverted here (Q8, option b)

Profile smoke test:
- [ ] login, logout
- [ ] session refresh; expired session → sign-in and back to the original page with an encoded query (C14)
- [ ] one protected route as an unauthorized user (staff, counter, platform)
- [ ] one CRUD flow
- [ ] one stale edit → 409 with Reload
- [ ] main dashboard pages
- [ ] one form with validation
- [ ] dark mode

Specific to this upgrade:
- [ ] Switch user/cafe: no data from the previous identity, in-flight responses discarded (C12)
- [ ] 404 page and a forced 500: page renders, security headers present (C15)
- [ ] Unsaved-changes prompt: after typing, not on open; confirm dialog cancel/confirm (C22, C27)
- [ ] Searchable RecordSelect: type, keyboard select, focus stays, closes on touch (C23)
- [ ] AppDrawer at phone width; menu item slide-over ~672px from `sm`, full width on phone; option set slide-over at phone and tablet (C24, C25)
- [ ] First toast after sign-in, and a toast while offline (C28)
- [ ] Admin sidebar menu (phone) and search palette (Ctrl/Cmd+K) open on first use (C28)
- [ ] Customer menu: scroll spy, category bar, one in-page hash link; back/forward restores position (C4)
- [ ] Light, dark and print of an admin page and the customer menu (C20, C21)
- [ ] Assistant panel chat send (C29, C32)

After merge:
- [ ] Staging deploy succeeds and a staging request works end to end (C17); rollback = `wrangler rollback`
