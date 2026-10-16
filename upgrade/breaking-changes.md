# Breaking changes — nuxt-ui-latest
Range: nuxt 4.5.2 → 4.6.1 (4.6.0, 4.6.1) | @nuxt/ui 4.11.2 → 4.12.0 (4.11.3, 4.12.0) | vue-router 5.3.1 → 5.4.0 (required by nuxt 4.6.1) | @nuxt/cli 3.37.0 → ^4.0.1 (transitive) | unhead 3.4.1 → ^3.4.2 (transitive)

Sources (all read in full or by section; raw copies in `upgrade/logs/src/`, git-ignored):
- S1 https://github.com/nuxt/nuxt/releases/tag/v4.6.0
- S2 https://github.com/nuxt/nuxt/releases/tag/v4.6.1
- S3 https://github.com/nuxt/ui/releases/tag/v4.11.3
- S4 https://github.com/nuxt/ui/releases/tag/v4.12.0
- S5 https://github.com/vuejs/router/releases/tag/v5.4.0
- S6 https://github.com/nuxt/cli/releases/tag/v4.0.0
- S7 published package contents: `@nuxt/ui@4.12.0` and `@nuxt/nitro-server@4.6.1` tarballs (inspected locally), `pnpm view nuxt@4.6.1|@nuxt/ui@4.12.0 dependencies|peerDependencies`

## Summary
- affected: 13 | not affected: 18 | unknown: 5 (36 rows)
- Neither Nuxt release lists a breaking change for Nuxt 4 apps ("Nothing in this release requires a migration", S1). 4.6.1 is a patch with fixes only (S2). Nuxt UI 4.11.3 and 4.12.0 list no breaking changes, only behavior fixes (S3, S4). vue-router 5.4.0 has one item labelled breaking, scoped to the `experimental` entry (S5).
- The one real structural impact: Nuxt UI 4.12.0 no longer imports from `reka-ui/namespaced` (S4 #7176, confirmed in S7: 0 references in the 4.12.0 package vs 13 files in the installed 4.11.2). The local module `modules/reka-namespaced.ts` becomes a silent no-op (C1).
- Hard requirement: Node `^22.22.3 || ^24.15.0 || >=26` (S1). Installed Node 24.17.0 is OK.
- official codemods: none. `npx nuxt upgrade --dedupe` is recommended by S1; do not run it blindly, because it would also move the lockfile and unrelated deps. Use explicit `pnpm up` per the plan.

## Changes
| ID | Package | Version | Change | Affected | Where (files/count) | Fix type | Source |
|----|---------|---------|--------|----------|---------------------|----------|--------|
| C1 | @nuxt/ui | 4.12.0 | Reka UI primitives imported by name, not from `reka-ui/namespaced` | yes | `modules/reka-namespaced.ts`, `test/unit/reka-namespaced.test.ts`, `test/e2e/shop-menu.test.ts:82` (D123), docs (decisions.md, development.md:56, ui.md:208, progress.md) | manual | S4 #7176, S7 |
| C2 | nuxt | 4.6.0 | Node requirement `^22.22.3 \|\| ^24.15.0 \|\| >=26` | no (24.17.0) | CI / deploy Node version not pinned in repo (no `engines`, `.nvmrc`) | config | S1, S6 |
| C3 | nuxt | 4.6.0 | `vue-router` dep now `^5.4.0` | yes | `package.json` `vue-router ^5.3.1`; lockfile | config | S7 (`pnpm view nuxt@4.6.1`) |
| C4 | vue-router | 5.4.0 | "Restore hashes and top by default" (router scroll behavior) | unknown | no custom `scrollBehavior`/`router.options` in `app/`; Nuxt supplies its own router scroll; app scroll code in `useScrollSpy.ts`, `MenuCategoryBar.vue`, `MenuPage.vue`, `useCenteredTab.ts` | manual (verify) | S5 |
| C5 | vue-router | 5.4.0 | Experimental-only breaking: query arrays, hash params, guard redirects, `definePage`/typed-router changes | no | no `definePage`, no typed routes, no `experimental.typedPages`, no `router.beforeEach` (inventory §3) | none | S5 |
| C6 | nuxt | 4.6.0 | `<NuxtLink>` with no matching route falls through to full-page load instead of rendering 404 (#36169) | unknown | 22 `<NuxtLink>` in 9 files + `navigateTo`; links built with `useTenantPath()`; `/api`, `/media` links? | manual (verify) | S1 |
| C7 | nuxt | 4.6.0 | `nitro.*` options duplicated at top level deprecated (#36416); warns | no | `nuxt.config.ts` root `nitro` uses `scheduledTasks`, `experimental.tasks`, `preset` (staging) , `cloudflare.wrangler`. No top-level duplicate exists for these; a deprecation warning may still appear. | config (verify) | S1 |
| C8 | nuxt | 4.6.0 | `nuxt/server` import surface; auto-imported `defineEventHandler`, `getQuery`, `readBody` remain h3's own on Nuxt 4; mixing causes `NUXT_E80xx` | no | App uses explicit `h3` imports (inventory §4); no switch to `nuxt/server`. Opt-in only ("Nothing has been taken away") | none | S1 |
| C9 | nuxt | 4.6.0 | `runtimeConfig.app` and `runtimeConfig.appSecret` reserved; `NUXT_APP_SECRET` | no | runtimeConfig groups are maintenance, seed, mail, qrSecret, ai, telegram, bakong; none named `app` or `appSecret`. Env `NUXT_APP_SECRET` unused. | none | S1 |
| C10 | nuxt | 4.6.0 | `typescript.tsConfig` is now a shared baseline for all 4 generated tsconfigs | no | no `typescript.tsConfig` in `nuxt.config.ts`; root `tsconfig.json` only references generated files | none | S1 |
| C11 | nuxt | 4.6.0 | Typed `$fetch` rebuilt (opt-in `experimental.routeTypedFetch`); 4.6.1 types global `$fetch` with `TypedFetch`, "accept any baseURL when fetch response type is named", `Serialize` aligned with JSON | unknown | 6 `$fetch<T>(...)` calls (`useAuth`, `useCounterSession`, `useCustomerAccount`, `usePlatformSession`, `errors.ts`), `apiFetch`/`useApiQuery` typing, `typecheck` | manual (verify via typecheck) | S1, S2 |
| C12 | nuxt | 4.6.0 | `useAsyncData` fixes: awaited call no longer resolves with unfetched data on hydration (#36124); awaited lazy data resolves immediately (#36301); newer entry no longer removed when older taken off (#36436); generic types (#36316) | yes (behavior) | `composables/useApiQuery.ts:37` (only call), `utils/invalidate.ts`, `plugins/session-boundary.client.ts` | manual (verify) | S1 |
| C13 | nuxt | 4.6.0 | `useState` initialised from a ref stays connected to payload (#36038) | no | `useState` calls use string keys + plain init (inventory §3); check none pass a `ref` | none | S1 |
| C14 | nuxt | 4.6.0 | `navigateTo` path encoding matches vue-router; percent-encoding kept in server redirects (#36055, #36112); `baseURL` with `open` | yes (behavior) | 47 `navigateTo` in 33 files incl. 3 global middleware and `plugins/api.ts`; paths containing encoded characters (tenant slugs, `?redirect` queries) | manual (verify) | S1 |
| C15 | nuxt | 4.6.0 | Error handling: unhandled error data no longer passed to the error page; internal error route only served to an error render; error renders no longer pass through Nitro middleware and route rules twice | yes (behavior) | `app/error.vue`, `server/error-handler.ts` (prepended via `nitro:config`), middleware `00`-`31`, `routeRules` (`ssr:false` zones, security headers) | manual (verify) | S1 |
| C16 | nuxt | 4.6.0 | `useRequestFetch` forwards request headers (#36180) | no | `useRequestFetch` not used; `apiFetch` server branch uses `useRequestURL` | none | S1 |
| C17 | nuxt | 4.6.0/4.6.1 | Nitro integration changes: server handlers/plugins registered per server API (#36317), `nitro:init`/`nitro:config` hooks, `.wrangler` ignored in schema (#36487) | unknown | `nuxt.config.ts:264-277` (`nitro:init` swaps entry to `server/cloudflare-entry.ts`, alias `#nitro-cloudflare-entry`), `:295-300` (`nitro:config` errorHandler). S7 confirms `nitro:init` and `nitro:config` still exist in `@nuxt/nitro-server@4.6.1` and nitropack stays `^2.13.4`, h3 `^1.15.11` (same as installed). Behavior of the custom Cloudflare entry not proven. | manual (verify on staging build) | S1, S7 |
| C18 | nuxt | 4.6.0 | Vite: layers pre-bundled, SSR externals resolved from importer, build fails when a template never compiles (#36208, #36309, #36322) | no | no layers; build previously exited 0 so a hidden template failure could now fail the build | none | S1 |
| C19 | @nuxt/cli | 4.0.0 | New CLI; `.nuxt/` lock for dev; `nuxt init` removed; Node 22.21+/24.11+/26+ | no | scripts use `nuxt build/dev/prepare/typecheck/generate/preview`; `test/e2e/support/global-setup.ts:60` runs `pnpm nuxt build`. The baseline run showed the CLI's build-lock guard ("Another Nuxt build is already running", `NUXT_IGNORE_LOCK`), so parallel/overlapping builds fail | none | S6, baseline log |
| C20 | @nuxt/ui | 4.11.3 | `module`: use `@custom-variant` for `light` and `dark` variants (#7023); `module`: classes prefixed by `usePrefix` (#7074); theme: drop double quotes from class strings (#7039) | yes | `tailwind.css` relies on `.light`/`.dark` class selectors and `@media print` overrides; `colorMode` fixed to `light` | manual (verify) | S3 |
| C21 | @nuxt/ui | 4.12.0 | "theme: remove unknown and conflicting classes" (names not listed); review custom theme overrides | unknown | `app/app.config.ts` slot overrides: `dashboardNavbar`, `dashboardPanel`, `dashboardToolbar`, `tabs` (+compoundVariants), `card`, `checkbox`, `radioGroup`, `switch`, `modal`, `slideover`, `drawer`; ~98 inline `:ui` | manual (visual check) | S4 |
| C22 | @nuxt/ui | 4.12.0 | `Form`: state type accepts empty values (#7165); 4.11.3: nested forms in parent `dirty` (#6545), dirty/validation in sync with input (#7033), unnamed nested forms merge (#7034) | yes (behavior) | ~26 `UForm` files, `TaskFrame.vue`, `composables/useFormErrorRecheck.ts` (uses `getErrors`/`validate`), `useUnsavedChanges.ts`, valibot schemas | manual (verify) | S3, S4 |
| C23 | @nuxt/ui | 4.11.3/4.12.0 | `SelectMenu`: focus kept on selection (#7083), menu stays open when focus moves outside (#7095), controls outside listbox (#7096) | yes (behavior) | `components/RecordSelect.vue:49`, `BranchSettingsTab.vue:258`, `CafeFormModal.vue:187`; `Select` fix #7083 also affects 9 `USelect` | manual (verify) | S3, S4 |
| C24 | @nuxt/ui | 4.12.0 | `Drawer`: `noBodyStyles` no longer disables body pointer events (#7150); `after:enter`/`after:leave` now fire at animation end (#7107) | yes | `components/AppDrawer.vue`, drawer theme in `app.config.ts`; any `@after:*` listeners | manual (verify) | S4 |
| C25 | @nuxt/ui | 4.12.0 | `Slideover`: width capped only from `sm` breakpoint (#7156) | yes | `OptionSetEditor.vue:1058`, `ProductFormSlideover.vue:1165` and `:ui content` overrides (`sm:max-w-*`) | manual (verify) | S4 |
| C26 | @nuxt/ui | 4.12.0 | `Table`: `defaultColumn` cell/header now respected (#7198); virtualized rows measured (#7204) | no | 8 `UTable` files; no `defaultColumn` use seen (not fully tallied) | none (verify) | S4 |
| C27 | @nuxt/ui | 4.11.3 | `useOverlay`: resolves every pending promise when reopened (#7057) | yes (behavior) | `useOverlay().create` ~16 call sites, `composables/useConfirm.ts:13`, `layouts/default.vue:23` | manual (verify) | S3 |
| C28 | @nuxt/ui | 4.12.0 | Lazy-loaded menu overlays (`DashboardSidebar`, `Header`, `Sidebar`), `DashboardSearch` palette, and `Toaster` toast | yes (behavior) | `UDashboardSidebar`, `UDashboardSearch` (`AdminSearch.vue`), `useToast` (~12 files); toast shown right after a mutation/session boundary | manual (verify) | S4 |
| C29 | @nuxt/ui | 4.12.0 | Localized/added accessibility labels (Pagination, Listbox, ChatMessages, ColorModeButton, etc.); `ColorModeButton` label resolves after mount | yes (text) | `ListPagination.vue`; `UColorModeButton` ~8 files; `AssistantPanel.vue` chat; a11y e2e using axe-core and label-based selectors may see different names | manual (verify tests) | S4 |
| C30 | @nuxt/ui | 4.12.0 | `App` follows `@nuxtjs/i18n` locale | no | `@nuxtjs/i18n` not installed; English chrome only | none | S4 |
| C31 | @nuxt/ui | 4.12.0 | New `Chart` component needs optional peer `@tanstack/charts` | no | `UChart` not used; no `@tanstack/*` imports | none | S4 |
| C32 | @nuxt/ui | 4.11.3 | `Kbd` avoids hydration mismatch (#7166), `useToast` pulse skip (#7195), `ChatPrompt` `method="post"` (#7078) | no (additive fixes) | `UKbd` ~4, `AssistantPanel.vue` | none | S3, S4 |
| C33 | @nuxt/ui | 4.12.0 | Additive props/slots (Calendar `yearsPerPage`, CheckboxGroup `max`, InputNumber `startingValue`/`allowInvalid`, etc.) | no | additive only | none | S4 |
| C34 | nuxt | 4.6.0 | Nuxt 5 flags behind `future.compatibilityVersion: 5` (typed pages, case-sensitive routing, early `navigateTo` return, inline error rendering, etc.) | no | no `future` key set; do not enable | none | S1 |
| C35 | nuxt | 4.6.0 | Vue Vapor, `@nuxt/vite-server`, `defineUseFetchAddon`, early 404s, cookie jars | no | all opt-in; not used | none | S1 |
| C36 | peer ranges | n/a | Third-party modules vs targets | no | see Module compatibility | none | S7 |

## Details (only affected = yes or unknown)

### C1 — Local Reka namespaced-barrel splitter becomes a no-op
- what changed: Nuxt UI 4.12.0 "import Reka UI primitives by name instead of from `reka-ui/namespaced`" (S4 #7176). Inspection of the published package confirms zero references to `reka-ui/namespaced` in 4.12.0, versus 13 files in the installed 4.11.2.
- how it affects this app: `modules/reka-namespaced.ts` (D123) only transforms code that contains `reka-ui/namespaced`, so after the upgrade it does nothing and its "definition not found" failure never triggers (it only fires on imports that exist). The behavior it protects (the customer menu must not load the admin's calendar/date/time code) is asserted by `test/e2e/shop-menu.test.ts:82`. Unit test `test/unit/reka-namespaced.test.ts` keeps passing because it tests the module's pure functions in isolation, so it will not signal the module is dead.
- fix: do not remove anything in the version-bump step. Run the e2e at line 82 after the bump. If it passes, removing the module, its unit test and updating the docs/decision D123 is a follow-up that needs your decision (see Unknowns U1). If it fails, Nuxt UI's by-name imports are not enough and the module must be adapted: that is a manual step.
- risk: medium (bundle-size regression guard, not a correctness or security issue)

### C3 — vue-router must move with nuxt
- what changed: `nuxt@4.6.1` depends on `vue-router ^5.4.0` (installed 5.3.1). The app declares `vue-router` directly (`^5.3.1`).
- how it affects this app: if left at 5.3.1 the direct dependency and Nuxt's own would resolve to two versions (or a peer warning). pnpm may place two copies of vue-router.
- fix: bump direct `vue-router` to `^5.4.0` in the same step as nuxt, then `pnpm dedupe` check (`pnpm why vue-router`).
- risk: low

### C4 — vue-router 5.4.0 "Restore hashes and top by default"
- what changed: S5 lists "Restore hashes and top by default" under router features. The note does not say what the previous default was or whether Nuxt's router passes its own `scrollBehavior`. unknown.
- how it affects this app: scroll position on navigation and hash links. The menu page uses its own scroll spy; no custom `scrollBehavior` is configured.
- fix: verify with the e2e menu and orders flows plus a manual check of in-page hash anchors.
- risk: low

### C6 — NuxtLink falls through for unmatched routes
- what changed: a `<NuxtLink>` to a path with no route does a full-page load instead of rendering the 404 (#36169, S1).
- how it affects this app: links to API/media paths or typos would load the server response instead of the app 404. The app's links are built with `useTenantPath()`. Unknown whether any link targets a non-page path.
- fix: none expected; confirm by grepping NuxtLink/`to=` targets that start with `/api` or `/media` during Phase 3 or review.
- risk: low

### C7 — Deprecation of duplicated `nitro.*` options
- what changed: `nitro.*` options that exist at the top level are deprecated (#36416); Nuxt now points to the top-level option.
- how it affects this app: `nuxt.config.ts` sets `nitro.scheduledTasks`, `nitro.experimental.tasks`, `nitro.preset` and `cloudflare.wrangler`, and the top-level aliases listed in S1 are `prerender`, `runtimeConfig`, `routeRules`. None of those used here is duplicated, so only a warning at most.
- fix: if a warning appears in the build log, move to the top-level equivalent; otherwise none.
- risk: low

### C11 — Typed `$fetch` / `Serialize` type changes
- what changed: S2 "type the global `$fetch` with nuxt's `TypedFetch`" (#36492), "align `Serialize` object types with JSON" (#36503), "accept any `baseURL` when fetch response type is named" (#36523). The opt-in `routeTypedFetch` is off.
- how it affects this app: inferred return types of the 6 `$fetch<T>` calls and `apiFetch` could change, producing new typecheck errors.
- fix: run `pnpm typecheck` after the bump; fix with explicit types, never `any`/`@ts-ignore`.
- risk: low

### C12 — useAsyncData hydration and entry-removal fixes
- what changed: awaited `useAsyncData` no longer resolves with unfetched data on hydration (#36124), awaited lazy data resolves immediately (#36301), a newer entry is no longer removed when an older one is taken off (#36436, S1 changelog).
- how it affects this app: `useApiQuery` is the only call site and every app read goes through it. It interacts with `refreshNuxtData`/`clearNuxtData`, the session-boundary plugin and identity-bound key filtering (AGENTS.md rule: clear identity-bound queries on session transitions; discard stale in-flight responses). The comments in `useApiQuery.ts` mention a Nuxt 4.5 watch-path workaround that may now be redundant or conflict.
- fix: manual review of `useApiQuery.ts` against the 4.6 behavior; run unit and e2e covering stale responses and session transitions.
- risk: high (data-fetch layer for the whole app; identity-bound caching ties into the auth/data-scoping high-risk areas)

### C14 — navigateTo encoding behavior
- what changed: path encoding now matches vue-router (#36055); percent-encoding preserved in server redirects (#36112).
- how it affects this app: 47 `navigateTo` calls and three global middleware that redirect to sign-in with a return path/query (`auth.global.ts`, `counter.global.ts`, `platform.global.ts`), plus `plugins/api.ts` 401 handling.
- fix: verify redirect-with-return-path round trip (encoded `?redirect=`), covered by manual smoke test items (login, expired session, unauthorized route).
- risk: high (authentication redirect flow, high-risk area 1)

### C15 — Error rendering changes
- what changed: unhandled error data is no longer passed to the error page; error renders do not run through Nitro middleware and route rules a second time; the internal error route is restricted (S1 Security).
- how it affects this app: custom `app/error.vue` and `server/error-handler.ts`; the middleware chain (`00.request-id` to `31.cafe-pages`) and `routeRules` security headers. If error responses previously got CSP/HSTS headers or request-id via the second pass, they might not now.
- fix: manual check of an error render (404 page, forced 500) for headers and body shape against current behavior; compare with the server error response shape rules in `docs/reference/errors.md`.
- risk: high (server behavior: error shape, status codes, middleware order, security headers)

### C17 — Nitro/Cloudflare integration
- what changed: handler/plugin registration reworked per server API (#36317); `.wrangler` ignored (#36487); S7 shows the `nitro:init`/`nitro:config` hooks still exist and nitropack/h3 ranges are unchanged.
- how it affects this app: the repo replaces the Cloudflare entry in `nitro:init` and prepends an error handler in `nitro:config`; staging deploys build with `preset: cloudflare_module`. A change in how Nuxt resolves the entry could break this only at staging build time.
- fix: `pnpm build` and `pnpm build:staging` (verify `.output/server/wrangler.json`, entry wrapper); a staging deploy is out of scope for this run (no deploy per RULES).
- risk: high (runtime/server behavior, DB bindings)

### C20 — Tailwind `light`/`dark` variants via `@custom-variant`
- what changed: Nuxt UI's module now defines `light` and `dark` variants with `@custom-variant` (#7023, S3 4.11.3).
- how it affects this app: `tailwind.css` overrides the `--ui-*` color tokens on `.light`/`.dark` classes and has print overrides; `colorMode` is forced to `light` with a dark mode still supported per AGENTS.md.
- fix: visual check in both themes and print; no code change expected.
- risk: medium

### C21 — Theme class cleanup
- what changed: "remove unknown and conflicting classes" in theme (S4); the exact classes are not named, so unknown.
- how it affects this app: `app.config.ts` overrides plus ~98 inline `:ui`; a class a component no longer emits could change how tailwind-merge resolves an override.
- fix: compare the built theme for the overridden components; manual visual check of dashboard shell, tabs, cards, drawer, modal and form controls.
- risk: medium

### C22 — Form dirty/validation behavior
- what changed: nested forms count toward the parent's `dirty` (#6545), dirty and validation stay in sync with input (#7033), unnamed nested forms merge (#7034), `state` type accepts empty values (#7165).
- how it affects this app: `useUnsavedChanges`, `useFormErrorRecheck` (reads `getErrors`/`validate`), form drafts and the "every edit sends the version" flow rely on form state; possible changed `dirty` timing or type errors in schema/state typing.
- fix: run unit and e2e for forms; typecheck; manual test of one form with validation and the unsaved-changes prompt.
- risk: medium

### C23 — SelectMenu / Select focus and open behavior
- what changed: focus handling and open state fixes (S3 #7083, S4 #7095/#7096).
- how it affects this app: `RecordSelect` (searchable, virtual scroll, `v-model:search-term`), branch/cafe pickers, and the page-size `USelect` in `ListPagination`; touch/keyboard flows.
- fix: manual check of searchable select and keyboard selection; e2e covering these pickers.
- risk: medium

### C24 — Drawer behavior
- what changed: `noBodyStyles` no longer disables body pointer events (#7150); `after:enter`/`after:leave` fire when the animation ends (#7107).
- how it affects this app: `AppDrawer.vue` and the `drawer` slot overrides in `app.config.ts`.
- fix: check `AppDrawer` listeners and drawer behavior on a compact (touch) layout.
- risk: low

### C25 — Slideover width cap
- what changed: width capped from `sm` upward only (#7156).
- how it affects this app: the two slideovers and their inline `sm:max-w-*` content overrides in compact layouts.
- fix: visual check at phone and tablet widths.
- risk: low

### C27 — useOverlay promise resolution
- what changed: reopening an overlay now resolves every pending promise (#7057).
- how it affects this app: `useConfirm` and ~16 `useOverlay().create` call sites that await `open()` results.
- fix: confirm no call site reopens the same overlay instance while a previous `open()` is pending; run confirm/unsaved-changes tests.
- risk: medium

### C28 — Lazy-loaded overlays and toaster
- what changed: sidebar/header menu overlays, search palette and toast component now load on demand (S4).
- how it affects this app: first toast or first palette open now triggers a dynamic import; relevant to the offline banner and session-boundary toasts (network may be unavailable at that point) and to e2e timing.
- fix: run e2e; manual check that a toast shown while offline still appears.
- risk: medium

### C29 — Accessibility labels
- what changed: several default aria-labels are now localized or added (S4).
- how it affects this app: axe-core a11y tests, label/role-based selectors in e2e, and the assistant UI.
- fix: run a11y and e2e suites; update expectations only if a test pinned an old default label (do not weaken tests).
- risk: low

## Module compatibility
| Module | Current | Needed | Supports target? | Source |
|---|---|---|---|---|
| @nuxt/ui | 4.11.2 | 4.12.0 (target) | yes: peers tailwindcss ^4, vue-router ^4.5 or ^5, valibot ^1, typescript ^5.6 or ^6 or ^7, @internationalized/date ^3, ai ^6 or ^7 (all optional) | S7 `pnpm view @nuxt/ui@4.12.0` |
| nuxt | 4.5.2 | 4.6.1 (target) | needs vue ^3.5.43 (have 3.5.43) and vue-router ^5.4.0 (have 5.3.1, must bump) | S7 |
| @nuxthub/core | 0.10.8 | latest 0.10.8 | no nuxt peer declared; cannot be proven from metadata, check at build | `pnpm view` |
| @nuxtjs/better-auth | 0.3.5 (exact pin) | latest 0.3.10 | peers better-auth >=1.7.3 <2, @nuxthub/core >=0.10.5, @nuxt/test-utils ^4.1 satisfied; no nuxt peer. 0.3.5 stays; bump is not required by the targets | `pnpm view` |
| @nuxt/eslint | 1.17.0 | 1.17.0 | peer eslint ^9 or ^10 OK | `pnpm view` |
| @nuxt/test-utils | 4.3.2 | 4.3.3 | peer nuxt ^3.21 or ^4 or ^5-0 OK (accepts 4.6.1) | `pnpm view` |
| h3 (pinned 1.15.11) | 1.15.11 | nuxt 4.6.1 / nitro-server `^1.15.11` | yes | S7 |
| nitropack (transitive) | 2.13.4 | `@nuxt/nitro-server@4.6.1` `^2.13.4` | yes, unchanged | S7 |
| @nuxt/cli (transitive) | 3.37.0 | ^4.0.1 | pulled in by nuxt 4.6.1; needs Node 24.15+ (have 24.17.0) | S6, S7 |
| vue / vue-tsc / typescript / tailwindcss | 3.5.43 / 3.3.11 / 6.0.3 / 4.3.3 | unchanged | yes | S7 |
| pnpm release-age policy | `minimumReleaseAge` active (only `@nuxtjs/better-auth@0.3.5` excluded) | | may block installing just-published versions; check at install | `pnpm-workspace.yaml` |

## Unknowns that need my decision
- U1 (C1): After the bump, if `shop-menu.test.ts:82` passes without the local module, do you want `modules/reka-namespaced.ts`, `test/unit/reka-namespaced.test.ts` and the D123 docs retired in this run, or kept untouched and handled in a separate PR? Recommendation: separate PR, because the module is a harmless no-op and removal touches decisions and docs.
- U2 (scope): Should this run bump `@nuxtjs/better-auth` 0.3.5 → 0.3.10? It is not required by the targets and sits in the authentication high-risk area. Recommendation: no.
- U3 (C4, C6, C11, C17): these cannot be settled from documentation alone; the plan should treat them as verify-after-bump items. No decision needed unless you want a staging build verified before merge.
- Baseline note (Phase 0): the first baseline `test`/`build` results were invalid because an orphaned earlier run held the Nuxt build lock; a rerun is in progress. Compare against that result, not the first one.
