# Inventory — nuxt-ui-latest
Generated: 2026-10-16 | Targets: nuxt 4.5.2 → 4.6.1, @nuxt/ui 4.11.2 → 4.12.0 (vue-router 5.3.1 → ≥5.4.0 required by nuxt 4.6.1)
Areas scanned: A (deps/config), B (Nuxt UI), C (app/framework APIs), D (server/auth/data).
Scanner counts are grep-based; ±2 possible. No secret values recorded.

## 1. Dependencies, modules & config

**package.json**: pnpm@12.3.4, no `engines`, no Node pin. `nitropack`/`nitro`/`vite` are NOT direct deps (transitive via nuxt). `h3` pinned 1.15.11, `@nuxthub/core` 0.10.8 and `@nuxtjs/better-auth` 0.3.5 pinned exact.
Scripts: `postinstall: nuxt prepare`, `typecheck: nuxt typecheck`, `test:unit` = vitest projects `unit`+`server`, `test:e2e` = project `e2e`.
`pnpm-workspace.yaml`: `allowBuilds` (esbuild, unrs-resolver, vue-demi, workerd); `minimumReleaseAgeExclude: @nuxtjs/better-auth@0.3.5`; overrides `undici@7`, `tinypool@2`, `sharp@0.35`; 6 `auditConfig.ignoreGhsas`.
Note: a minimum release age policy appears active, so brand-new releases (nuxt 4.6.1 / ui 4.12.0) may be blocked at install. Check in Phase 4.

**nuxt.config.ts**
| Item | Where | Detail |
|---|---|---|
| modules | :95 | `@nuxt/eslint`, `@nuxt/ui`, `@nuxt/test-utils/module`, `@nuxthub/core`, `@nuxtjs/better-auth` |
| local module | `modules/reka-namespaced.ts:78-83` | `defineNuxtModule`, `addVitePlugin` (build only). Not in `modules` array; relies on root `modules/` auto-registration |
| experimental | :243 | `checkOutdatedBuildInterval: 5*60_000`; `nitro.experimental.tasks: true` (:247) |
| other flags | :144-159 | `compatibilityDate: '2025-07-15'`, `ssr: true`, `devtools.enabled`; no `future`, no `compatibilityVersion`, no `extends`/layers, no `alias`, no `vite` key |
| nitro | :104-132, :245-250 | staging-only `preset: cloudflare_module`; `scheduledTasks` (3 cron groups, 9 tasks); staging `cloudflare.wrangler` (observability, vars, crons, 3 ratelimits) |
| nitro hooks | :264-277, :295-300 | `nitro:init` swaps entry to `server/cloudflare-entry.ts` + alias `#nitro-cloudflare-entry`, copies libsql binary on `node*` presets; `nitro:config` prepends `server/error-handler.ts` to `errorHandler` |
| hub | :251-263, :133-137 | `blob: true`; `db` sqlite, `casing: snake_case`, `connection.timeout: 5000`; `E2E_HUB_DIR` overrides `hub.dir`; staging D1 `databaseId` + R2 blob binding `BLOB` |
| hub hooks | :282-294 | `hub:db:schema:extend` adds `server/features/<f>/<f>.schema.ts`; `prepare:types` adds `hub/db/schema.d.ts` |
| runtimeConfig | :160-198 | private groups: maintenance, seed, mail, qrSecret, ai, telegram, bakong; public: `cafeTimeZone`, `defaultTenant`, `sampleData.{enabled,environment}` |
| routeRules | :199-239 | `ssr:false` for admin/table/checkout/orders/counter/platform/cafes; `swr:60` on `/c/*` (unless `E2E_HUB_DIR`); `auth:'user'` on `/api/c/*/admin\|counter\|shop/**`, `/api/platform/**`, `/api/me/**`; `no-store` on `/api/**`; security headers on `/**` prod+staging |
| colorMode | :159 | `preference: light`, `fallback: light` |
| icon | :308-322 | `provider: 'none'`, `clientBundle.scan` globs |
| eslint | :302-307 | `stylistic: true`, `formatters: true` |
| css | :155 | `@/assets/css/tailwind.css` |

**Nuxt UI config**: `app/app.config.ts` `ui.colors` primary=amber, neutral=stone; component overrides: `dashboardNavbar`, `dashboardPanel`, `dashboardToolbar`, `tabs` (slots + compoundVariants), `card`, `checkbox`, `radioGroup`, `switch`, `modal`, `slideover`, `drawer`. No `ui:` in nuxt.config.
**Tailwind**: `app/assets/css/tailwind.css` has `@import 'tailwindcss'`, `@import '@nuxt/ui'`, `@layer base`, `@media print`, `@utility page-narrow`, `@utility scrollbar-none`; overrides `--ui-primary/warning/success/error/info` on `:root/.light/.dark`. No `@theme`, `@source`, `@plugin`.
**tsconfig**: root `files: []` + 4 references to `.nuxt/tsconfig.{app,server,shared,node}.json`.
**vitest.config.ts**: projects `unit`, `server`, `e2e` (globalSetup `test/e2e/support/global-setup.ts`), conditional `eval` (`ASSISTANT_EVAL`), conditional `nuxt` (inactive, no matching tests). Aliases `#shared`, `#server`, `~`, `#auth/schema` → `.nuxt/better-auth/schema.sqlite.ts`, `hub:db:schema` → `.nuxt/hub/db/schema.mjs`.
**eslint.config.mjs**: extends `.nuxt/eslint.config.mjs`; custom rules for feature boundaries, server import aliases, `useTenantPath()`.
**No root** `wrangler.*` or `drizzle.config.*` (wrangler config is generated at `.output/server/wrangler.json`).

## 2. Nuxt UI / Tailwind usage (Area B)

Tag counts (repo-wide incl. ~36 doc lines): UButton 442, UIcon 116, UFormField 107, UAlert 85, UBadge 81, UCard 66, USkeleton 44, UDashboard* 86 (Group, Sidebar, SidebarCollapse, Panel, Navbar, Toolbar, Search, SearchButton), UInput 52, UTooltip 33, UModal 30, UForm 29, UDropdownMenu 27, UCheckbox 26, UInputNumber 18, USeparator ~17, UTable 14 (8 `.vue` files), USwitch 10, USelect 9, UTabs 8, UColorModeButton ~8, ULink ~8, UPopover 6, UTextarea/URadioGroup/UCheckboxGroup 22, USelectMenu 3, UCalendar 3, UBreadcrumb 3, UFieldGroup 3, UChat* 3, UKbd ~4, UAvatar ~4, USlideover 2, UApp 2, UNavigationMenu 2, UCollapsible 2, UProgress 2, UDrawer 1, USidebar 1, UPagination 1, UChip 1, USlider 1, UTimeline 1, UInputTime 1.
Not used: UInputMenu, UInputDate, UCommandPalette, UCarousel, UContextMenu, UStepper, UEditor, UFileUpload, UTree, `Lazy*U*`, `@tanstack/*`, `getCoreRowModel`.
Heaviest files: `features/promotions/components/PromotionEditorPage.vue` (~48 tags), `products/ProductListPage.vue` (~38), `modifier-groups/ModifierGroupPage.vue` (~30), `account/AccountButton.vue` (~23), `menu/CheckoutPage.vue` (~23).

**`:ui` overrides**: ~98 across ~70 `.vue` files. Slot keys: `body`, `footer`, `content`, `root`, `trailing`/`trailingIcon`, `label`, `header`, `list`, `fieldset`, `item`, `tfoot`/`td`, `overlay`, `legend`. Non-literal (ternary) examples: `menu/MenuItemDetail.vue:108`, `menu/MenuOffers.vue:120`, `option-sets/OptionSetEditor.vue:550`; `ItemSalesPage.vue:222` (tfoot/td). `composables/useMutation.ts:94` has `ui: { icon: 'animate-spin' }`.

**Composables**: `useToast` ~12 files (`useMutation.ts:53`, `useNotify.ts:11`, `plugins/session-boundary.client.ts:20`, `ProductReorderModal.vue:51`); `useOverlay` ~16 `.create(...)` + ~25 instances (`composables/useConfirm.ts:13`, `layouts/default.vue:23`); `defineShortcuts` at `layouts/default.vue:27` + wrapper `composables/useShortcuts.ts:34,48`; `useColorMode` only `AppearanceChoice.vue:7`.

**Forms**: UForm `:schema`/`:state` in ~26 `.vue` files with valibot (`import * as v from 'valibot'`; schemas in `*/schemas/*.ts` + ~8 inline). `TaskFrame.vue` gives UForm an `id` for an external submit button (`form=`). `composables/useFormErrorRecheck.ts` reads UForm's exposed `getErrors`/`validate` and props (internal-API coupling).
**Tables**: `TableColumn` from `@nuxt/ui` in 8 files (StaffListPage, PaymentsPage, CafesListPage, CounterFinishedPage, DeliveryHistoryCard, ItemSalesPage, OrderHistoryPage, ProductListPage); `composables/useTableSelection.ts` uses `v-model:row-selection` + `:get-row-id`.
**Select/date**: USelectMenu `components/RecordSelect.vue:49` (searchable, `v-model:search-term`, virtual scroll), `BranchSettingsTab.vue:258`, `CafeFormModal.vue:187`; UCalendar `ReportPeriodPicker.vue:142,210`, `PromotionDateField.vue:44`; UInputTime `components/TimeInput.vue`.
**Assistant UI**: `features/assistant/components/AssistantPanel.vue:84-1044` uses UChatMessages/UChatPrompt/UChatPromptSubmit/USidebar (optional peer `ai` ^6 or ^7; repo has ai ^7.0.122 and `@ai-sdk/vue`).
**Overlays**: `v-model:open`/`@update:open` ~60 uses in ~45 files; `USlideover` at `OptionSetEditor.vue:1058`, `ProductFormSlideover.vue:1165`.
**Custom wrappers** (app/components): ConfirmDialog (UModal), AppDrawer (UDrawer), TaskFrame (UForm+UCard), ListPagination (UPagination+USelect+UInputNumber), ListEmptyState, ListSkeleton, SearchInput (UInput+UKbd), PhoneInput, RecordSelect, TimeInput, ImageInput, QuantityStepper, StatusTabs/ToolbarTabs (UTabs `v-model`), AdminSearch (UDashboardSearch), BulkActionsBar, BottomActionBar, ShortcutsHelp (UModal), FormDraftAlert/ApiErrorAlert/OfflineBanner/NewVersionBanner (UAlert); composables `useTableSelection`, `useUnsavedChanges` (UModal `@update:open`), `useLayoutContext` (UModal); feature-level PasswordInput, FormErrorAlert, WeekdayStrip, CafeSwitcher (UDropdownMenu).

## 3. Nuxt / Vue / vue-router APIs (Area C; app/ only. `shared/` has zero Nuxt/vue-router imports)

| API | Count | Notes |
|---|---|---|
| `useAsyncData` | 1 real call | `composables/useApiQuery.ts:37` (only call; wraps data fetching). Comments at :4-:46 reference Nuxt 4.5 watch-path behavior |
| `refreshNuxtData` / `clearNuxtData` | `utils/invalidate.ts:33,71`; `plugins/session-boundary.client.ts:30,31` | also `useNuxtApp().payload.data` key filter at `invalidate.ts:69` |
| `$fetch` | 6 in 5 files | `plugins/errors.ts:15`, `useCounterSession.ts:34`, `useCustomerAccount.ts:35,52`, `useAuth.ts:45`, `usePlatformSession.ts:27`; `plugins/api.ts` builds from ofetch directly |
| `useState` | 23 in 12 files | keys e.g. `mutation:*`, `app:new-version`, `unsaved:forms`, `staff-session:*`, `counter-session:*`, `platform-session:*`, `account:*`, `assistant-panel:open`, `report-scope`, `bottom-action-bar:stack` |
| `useRuntimeConfig` | 13 hits / 9 files | only `public.*` + `app.buildId` |
| `useNuxtApp` | 9 / 6 files | `nuxtApp.runWithContext` in `plugins/api.ts:55-87`, `auth-sync.client.ts:38`; `nuxtApp.$router` at `useCounterSession.ts:124` |
| `navigateTo` | 47 / 33 files | object + string forms, `{replace:true}`; middleware, `plugins/api.ts`, `auth-sync.client.ts` |
| route middleware | 4, all `.global.ts` | `auth`, `counter`, `platform` (read `definePageMeta.public`), `unsaved-changes` (uses `abortNavigation()` after `useLeaveGuard().confirmLeave()`); no `addRouteMiddleware` |
| `defineNuxtPlugin` | 8 | `api.ts`, `errors.ts` universal object-form; 6 `.client.ts` (session-boundary, new-version, leave-guard, form-drafts, data-freshness, auth-sync) |
| `definePageMeta` | ~75 | keys: `layout` (shop, auth, counter, account, platform), `title`, `public`, `redirect` (function, `pages/c/[slug]/admin/reports/index.vue:2`) |
| `useHead` / `useSeoMeta` | 5 / 13 | `useSeoMeta` mostly `robots: noindex`; `MenuPage.vue:71` multi-line, unread |
| `<NuxtLayout>`/`<NuxtPage>` | `app/app.vue:36,37` | 6 layouts exist: default, account, auth, counter, platform, shop |
| `<NuxtLink>` | 22 in 9 files | |
| `#app` imports | 2 type-only | `error.vue:2` (`NuxtError`), `useApiQuery.ts:1` (`AsyncDataOptions`) |
| vue-router | `useRoute` ~60 / ~45 files, `useRouter` 13 | type imports `RouteLocationRaw` (`AccountFrame.vue:7`), `LocationQuery` (`useReports.ts:1`); no router guard API, no `definePage`, no typed routes |
| Not used | | `useFetch`, `useLazyFetch`, `useCookie`, `useRequestHeaders`, `useRequestEvent`, `callOnce`, `<ClientOnly>`, `<NuxtIsland>`, `Lazy*`, `#imports`, `#build` |

Wrapper composables: `useApiQuery` (`composables/useApiQuery.ts`), `useMutation` (`composables/useMutation.ts`), `apiFetch` (`utils/api.ts:25`), `useTenantPath` (`composables/useTenantPath.ts`); helpers `utils/mutation.ts`, `utils/invalidate.ts`, `composables/usePaginatedQuery.ts`, `composables/useUrlTab.ts`.
Page routes: `app/pages/**` incl. `pages/c/[slug]/{admin,counter,checkout,orders}`, `pages/platform`, auth pages (`sign-in`, `sign-up`, `reset-password`, ...).

## 4. Server, runtime & auth (Area D)

- **Routes**: 158 files (157 `server/api`, 1 `server/routes/media/[...key].get.ts`); GET 62, POST 72, PUT 9, PATCH 11, DELETE 2; catch-all `server/api/[...].ts`. Layout: `api/{health,client-errors}`, `api/webhooks/telegram.post.ts`, `api/platform/**`, `api/c/[slug]/{admin,counter,shop}/**`.
- **Middleware** (`server/middleware/`): `00.request-id`, `10.origin-check`, `20.rate-limit`, `30.old-addresses`, `31.cafe-pages`. `server/error-handler.ts` (set via `nitro:config`). `server/cloudflare-entry.ts` wraps `#nitro-cloudflare-entry` + `boundedWorkerRequest`. No `server/plugins/`, no `defineNitroPlugin`, no `defineCachedEventHandler`.
- **h3 imports** (value): `createError`, `isError` (`utils/errors.ts`), `getQuery`, `getRouterParam` (`utils/validation.ts`; 6 `getRouterParam` sites), `getRequestURL` (`utils/table-qr.ts`), `getHeader`, `getRequestWebStream` (`utils/request-body.ts`); `H3Event` type in ~13 util files; `sendRedirect` x2 (middleware 30, 31); `setResponseStatus` x22; `setResponseHeader(s)` (error-handler, rate-limit, 3 CSV routes); `getHeader(s)` x9. Tests import `createApp, eventHandler, toWebHandler, toNodeListener` (h3 v1 API). Not used: `readBody`, `readValidatedBody`, cookie helpers, `useStorage`, `hubKV`, `hubBlob`. No imports of `nitropack`, `nitro`, `ofetch`, `unstorage`, `@nuxthub/core` in `server/` or `shared/`.
- **useRuntimeConfig** in 13 server files (middleware 10/30, utils bakong/assistant/telegram/table-qr/sample-data, health, assistant chat); `event.context.cloudflare` only at `utils/rate-limit.ts:71`.
- **Better Auth**: module `@nuxtjs/better-auth`; `server/auth.config.ts` → `defineServerAuth(...)` → `identityAuthOptions` in `server/features/identity/identity.auth.ts` (plugins admin, organization, anonymous, haveIBeenPwned; session 7d / 1d update; `rateLimit.storage: 'database'`; `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']`; `generateId: newId`; `trustedOrigins`; before/after hooks via `createAuthMiddleware`). No cookie attributes set in repo. No `auth.handler`, `#auth`, or non-test `getSession`; `betterAuth(` only in `server/tests/support/auth.ts:11`. Origin/CSRF check in `middleware/10.origin-check.ts`.
- **Database**: `hub:db` imported only in `server/utils/db.ts:1` (`useDb()`); `hub:db:schema` in `server/db/tables.ts:7` (re-exports account, member, organization, session, user). 11 feature schema files; 40 migrations `0000..0039` in `server/db/migrations/sqlite` (+ meta). `db.batch(` 79 occurrences / 41 files (`utils/batch.ts` exports `runBatch`, `chunk`, `requireOneChange`, ...; `MAX_PARAMS=100`). `drizzle-orm/{sqlite-core,batch,libsql,d1,logger}` imports; `drizzle(` only in tests.

## 5. Cross-cutting notes
- Packages pulled in by the targets: nuxt → `@nuxt/nitro-server`, `@nuxt/vite-builder`, `@nuxt/vite-server` 4.6.1, unhead ^3.4.2, vue-router ^5.4.0; @nuxt/ui → `@nuxt/icon` ^2.5.1, `@nuxt/fonts` ^0.14.0, tailwindcss ^4.3.3.
- Closest couplings to Nuxt internals to check in Phase 2: `useApiQuery` ↔ `useAsyncData` watch/key behavior; `refreshNuxtData`/`clearNuxtData` + payload key filtering; session-boundary plugin; global route middleware ordering; `modules/reka-namespaced.ts` Vite plugin (Nuxt UI / reka-ui internals); `useFormErrorRecheck` (UForm exposed API); `:ui` slot names; `app.config.ts` slot overrides; `nitro:init`/`nitro:config` hooks + custom Cloudflare entry; `hub:db:schema:extend` hook.

## UNSURE (from scanners)
- Production D1/R2 binding config is not visible in repo (only staging `databaseId`); may be supplied by NuxtHub.
- `modules/reka-namespaced.ts` is not in the `modules:` array. Assumed auto-registered from root `modules/` (not verified).
- Better Auth cookie attributes are not set in repo; module defaults assumed.
- `.env`, `.env.example` and `server/cloudflare-entry.ts` bodies not read.
- Counts approximate: `useRoute`/`useRouter`, `:ui` total (~98), Nuxt UI tag totals (±2), `db.batch` non-test file count, `useRuntimeConfig(event)` vs no-arg split, `createError` direct calls (3; others via `utils/errors.ts`).
- Per-component Nuxt UI prop/slot/event tallies are partial (UButton `icon/loading/to`, UModal `title/description`, UTable `#*-cell` slots, UForm `@submit`, UPagination props not tallied).
- `MenuPage.vue:71` `useSeoMeta` keys unread.
- RESOLVED by me: layouts `shop` and `auth` exist; `unsaved-changes.global.ts` uses only `abortNavigation()` (`navigateTo` appears in a comment).
