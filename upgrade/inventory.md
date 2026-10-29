# Inventory — nuxt-4-6-2
Generated: 2026-10-29 | Targets: nuxt@4.6.2 (from 4.6.1; brings @nuxt/nitro-server, @nuxt/kit, @nuxt/schema, @nuxt/vite-builder 4.6.2 and vue ≥3.5.44)

Scanned areas: A (dependencies & config), C (app/framework APIs), D (server, runtime & auth). Not scanned: B (Nuxt UI, unchanged) and E (Drizzle, unchanged). Read-only scans by `upgrade-scanner`; counts are grep-based. `server/utils/request-body.ts` was re-checked by hand.

## 1. Dependencies, modules & config

**package.json**
- `nuxt ^4.6.1` (line 52): the range already allows 4.6.2; only the lockfile moves. `vue ^3.5.43` (59): allows 3.5.44. `vue-router ^5.4.0`.
- Exact pins: `h3 1.15.11` (50), `@nuxthub/core 0.10.8` (41), `@nuxtjs/better-auth 0.3.7` (42), `age-encryption 0.3.1`, `aws4fetch 1.0.20`.
- Not direct: `nitropack`, `vite` (transitive through nuxt).
- Engines: Node `^24.22.1`; `packageManager` pnpm 12.15.0. No `.nvmrc`.
- Scripts: `build`, `build:staging` (`--envName staging`), `build:production` (`--envName prod`), `postinstall` (`nuxt prepare`), `typecheck` (`nuxt typecheck && tsc -p ops/watchdog && tsc -p ops/backup`), `lint`, `test:unit`, `test:e2e`.

**nuxt.config.ts**
- Modules (142): `@nuxt/eslint`, `@nuxt/ui`, `@nuxt/test-utils/module`, `@nuxthub/core`, `@nuxtjs/better-auth`. No layers, no `extends`, no `modules/` folder.
- Flags: `compatibilityDate: '2025-07-15'` (343); `experimental.checkOutdatedBuildInterval` (342); `nitro.experimental.tasks: true` (346). No `future`, no `compatibilityVersion`. `ssr: true`; `devtools.enabled`.
- Nitro: `scheduledTasks` from `shared/scheduled-tasks.ts` (348). `preset: 'cloudflare_module'` only inside `$env.prod` (154-180) and `$env.staging` (191-226), each with `nitro.cloudflare.wrangler` (name, routes, vars, `send_email`, crons, ratelimits). A plain `pnpm build` uses the default (node) preset.
- Environment blocks: `$development` (143), `$env.prod` / `$env.staging` (146-232; `--envName` replaces `$production`, so each repeats the security headers), `$production` (234-238).
- Hooks (369-411): `nitro:init` swaps the entry to `server/cloudflare-entry.ts` for `cloudflare-module` (alias `#nitro-cloudflare-entry`, 381-382) and registers `compiled` (copy libsql binary for node presets); `nitro:config` prepends `server/error-handler.ts` to `errorHandler` (405-410); NuxtHub hooks `hub:db:schema:extend` (392) and `prepare:types` (402). Comment at 370: hooks go through `nitro:init` because `nitro.hooks.compiled` would replace the Cloudflare preset's own.
- `runtimeConfig` (255-294), names only: private `humanCheck`, `maintenance`, `devAccounts`, `mail`, `qrSecret`, `ai`, `telegram`, `bakong`; public `humanCheck`, `cafeTimeZone`, `sampleData`. Worker `vars` per environment set `NUXT_*` names (prod 163-174, staging 203-217).
- `hub` (350-362): `blob: true`, `db` sqlite snake_case `connection.timeout 5000`, `dir` only for e2e; env blocks set D1 and R2.
- Other: `colorMode` light (254), `app.head` (243-249), `icon` provider none + custom collection `app` (418-438), `eslint.config` stylistic + formatters (412-417), `css` tailwind entry (250), `vite.optimizeDeps.include ['valibot']`.

**routeRules** (the advisory's subject). Kinds used: `ssr`, `swr`, `auth`, `headers`. No `redirect`, `proxy` or `cache` rules.

| Pattern | Rule | Line |
|---|---|---|
| `/c/*/admin`, `/c/*/admin/**`, `/c/*/counter`, `/c/*/counter/**`, `/c/*/checkout`, `/c/*/orders`, `/c/*/orders/**`, `/table/**`, `/platform`, `/platform/**`, `/cafes` | `ssr: false` | 299-315 |
| `/c/*` | `swr: 60` (absent when `E2E_HUB_DIR`) | 321 |
| `/` | `swr: 3600` | 324 |
| `/api/c/*/admin/**`, `/api/c/*/counter/**`, `/api/c/*/shop/**`, `/api/platform/**`, `/api/me/**` | `auth: 'user'` (@nuxtjs/better-auth session gate; each route also checks permissions itself) | 329-335 |
| `/api/**` | `headers: cache-control: no-store` | 337 |
| `/**`, `/c/*` (analytics allowed), `/table/**`, `/reset-password`, `/verify-email` | `headers`: CSP, HSTS, `nosniff`, `X-Frame-Options`, referrer, COOP, permissions; token pages also `no-store, no-transform` | `deployedSecurityRules()` 62-72, applied in `$production` 237, `$env.prod` 153, `$env.staging` 190 |

**app/app.config.ts**: `ui.colors` (primary amber, neutral stone) and component overrides `dashboardNavbar`, `dashboardPanel`, `dashboardToolbar`, `tabs`, `card`, `checkbox`, `radioGroup`, `switch`, `modal`, `slideover`, `drawer`. No `ui` key in nuxt.config.

**CSS** `app/assets/css/tailwind.css`: `@import 'tailwindcss'`, `@import '@nuxt/ui'`, `@theme` (188), `@utility` ×3, `@apply` ×4. No `@source`, `@plugin`, `@config`.

**Other config**
- `tsconfig.json`: project references to `.nuxt/tsconfig.{app,server,shared,node}.json`; separate `ops/watchdog/tsconfig.json`, `ops/backup/tsconfig.json`.
- `wrangler.jsonc` only under `ops/watchdog` and `ops/backup` (compatibility_date 2025-07-15). The app's Worker config is generated into `.output/server/wrangler.json`; pre-upgrade copy in `upgrade/logs/baseline/wrangler.staging.json`.
- `vitest.config.ts`: `defineVitestProject` from `@nuxt/test-utils/config`; aliases `#shared`, `#server`, `~`, `#auth/schema` (`.nuxt/better-auth/schema.sqlite.ts`), `hub:db:schema` (`.nuxt/hub/db/schema.mjs`); projects `unit`, `server`, `e2e` (+ `eval`, `nuxt` when present).
- `eslint.config.mjs`: `withNuxt` from `.nuxt/eslint.config.mjs`.
- No `drizzle.config.*` (Drizzle through NuxtHub).

## 2. App/framework APIs (`app/`, `shared/`)

| API | Count | Where |
|---|---|---|
| `useAsyncData` | 1 | `app/composables/useApiQuery.ts:73` (the app's only read wrapper; reads `useNuxtApp().isHydrating` at 82; comments at 55, 92 cite Nuxt 4.5 watch behavior) |
| `useFetch`, `useLazyFetch`, `useLazyAsyncData` | 0 | |
| `$fetch` | 4 | `app/plugins/errors.ts:15`, `app/utils/two-factor.ts:34`, `SupportBanner.vue:18`, `useCustomerAccount.ts:101` |
| `refreshNuxtData`, `clearNuxtData` | 1 each | `app/plugins/session-boundary.client.ts:30-31` |
| `useState` | 27 in 11 files | mutation, new-version, unsaved changes, bottom bar, reports scope, assistant, account, auth/platform/counter sessions |
| `useNuxtApp` | 8 | useMutation, invalidate (×2), three session composables, AssistantPanel, useApiQuery |
| `useRuntimeConfig` | 8 | `app.buildId` (errors plugin), `public.humanCheck` ×2, `public.sampleData.enabled` ×2, `public.cafeTimeZone` ×3 |
| `navigateTo` | 57 in 37 files | string or `{ path, query }`; often `replace: true`; `00.trailing-slash.global.ts:10` uses `{ replace: true, redirectCode: 301 }`; `app/plugins/api.ts` ×6 inside `nuxtApp.runWithContext` |
| `defineNuxtRouteMiddleware` | 5 | all global: `00.trailing-slash`, `auth`, `counter`, `platform`, `unsaved-changes` |
| `addRouteMiddleware`, `useCookie`, `useRequestHeaders`, `useRequestEvent`, `callOnce` | 0 | |
| `definePageMeta` | ~62 pages | keys: `title` (nearly all), `layout` (`shop`, `account`, `counter`, `auth`, `platform`), `public: true` (3 sign-in pages), `redirect` function (2 report index pages), inline `middleware` (`app/pages/platform/index.vue:8`) |
| `defineNuxtPlugin` | 10 | object form `{ name, setup }`: `api.ts`, `errors.ts`; function form: 8 `.client.ts` plugins. No `enforce`/`parallel`/`dependsOn`/`hooks`/`env` options |
| `nuxtApp.hook` | 6 | `vue:error` (errors), `app:manifest:update` (new-version), custom `app:auth-changed` ×2, `app:session-changed`, `app:data-changed` |
| `useHead` / `useSeoMeta` | 5 / 15 | `useSeoMeta` mostly `robots: 'noindex'` |
| `<NuxtLayout>`, `<NuxtPage>` | 1 each | `app/app.vue:59-60` |
| `<ClientOnly>`, `<NuxtIsland>`, `Lazy*` | 0 | |
| `#app` imports | 3, type-only | `AnyServerRouteMethod`/`TypedFetchOptions` (`app/utils/api.ts:1`), `NuxtError` (`app/error.vue:2`), `AsyncDataOptions` (`useApiQuery.ts:1`) |
| `#imports`, `#build` | 0 | |

`ofetch` is imported in `app/plugins/api.ts:1`, `app/composables/useAuthRequest.ts:1` (values) and three type-only files. `shared/` uses none of these APIs.

## 3. Server, runtime & auth (`server/`, `shared/`)

**Routes.** 205 `server/api` handlers (all `defineEventHandler`): `c/[slug]/admin` 134, `c/[slug]/counter` 27, `platform` 26, `c/[slug]/shop` 7, `c/[slug]/public` 3, top level 3 (`[...].ts` 404 catch-all, `client-errors.post`, `health.get`), and one each in `me`, `cafes`, `tables`, `webhooks`, `password-ranges`. `server/routes` 3 GET files: `c/[slug]/admin.webmanifest`, `c/[slug]/counter.webmanifest`, `media/[...key]`. Better Auth's `/api/auth/**` comes from `@nuxtjs/better-auth` (no route file).

**Server middleware** (name order): `00.request-id`, `10.origin-check` (non-GET `/api/**`; exempts `/api/auth/`, `/api/webhooks/`), `20.rate-limit`, `25.trailing-slash` (301 via `sendRedirect`), `31.cafe-pages` (404 / 302 via `createError` / `sendRedirect`). No `server/plugins/`, no `defineNitroPlugin`.

**Entry, error handler, tasks**
- `server/cloudflare-entry.ts`: wraps the Nitro worker `fetch` with `boundedWorkerRequest`; wired by the `nitro:init` hook (see §1); type in `server/types/cloudflare-entry.d.ts`.
- `server/error-handler.ts`: `defineNitroErrorHandler` (29), only for `/api/` paths (30); `setResponseStatus`, `setResponseHeader`, `send`, `event.waitUntil`.
- `defineTask`: 12 (9 scheduled through `shared/scheduled-tasks.ts`, crons `* * * * *` ×4, `15 3 * * *` ×3, `5 * * * *` ×2; 3 dev-only).

**h3 usage**
- `defineEventHandler` 213 files; `defineCachedEventHandler` 0 (SWR caching comes from `routeRules` only).
- Value imports from `h3`: `createError`, `isError` (`server/utils/errors.ts:1`), `getRequestURL` (`table-qr.ts:2`), `getHeader`, `getRequestWebStream` (`request-body.ts:2`), `getQuery`, `getRouterParam` (`validation.ts:2`). `H3Event` type in 14 files. Auto-imported helpers also used: `readBody` 1 (telegram webhook), `getRouterParam` 9, `createError` 4, `sendRedirect` 2, `setResponseStatus` 1, `getHeader` ~8, `getRequestURL`, `setHeader`/`setResponseHeader`.
- **h3 internals** (re-checked): `server/utils/request-body.ts:20-22` reads `event.web?.request`, `event._requestBody`, `'__unenv__' in event.node.req`, and `event.node.req` (42) to read bodies with a size limit. `readValidatedBody`/`getValidatedQuery` not used (own `readValidBody`/`readValidQuery`).
- No imports from `nitropack`, `nitro`, `unstorage`, `ofetch` in `server/` or `shared/`. No `useStorage`.

**Data & bindings**: `useDb()` (`server/utils/db.ts`, `import { db } from 'hub:db'`), ~234 uses; schema via `hub:db:schema` (`server/db/tables.ts:13`); `blob.serve`/`blob.get` (NuxtHub auto-import) ×3; `event.context.cloudflare.env` read once (`rate-limit.ts:73`, rate-limit bindings); `useRuntimeConfig` 16 in 15 files (6 without `event`, in tasks/utils).

**Auth**: `defineServerAuth` (`server/auth.config.ts:7`) → `identityAuthOptions` (`server/features/identity/identity.auth.ts:43-188`): plugins `admin`, `organization`, `haveIBeenPwned`, `twoFactor`, `anonymous`; session 7 d / update 1 d; `rateLimit` storage `database` with `customRules`; IP header `cf-connecting-ip`; hooks via `createAuthMiddleware`. No cookie options in repo code (module/Better Auth defaults). Session reads: `getUserSession(event)` ×7 (`server/utils/access.ts:20, 55` and five `me` routes).

**Path string checks** (case-sensitive by code): `event.path.startsWith('/api/')` in `10.origin-check.ts:12-13` and `error-handler.ts:30`; `worker-body.ts:5-7` (Cloudflare entry, `pathname`); rate-limit prefixes and `/api/c/<slug>` stripping (`rate-limit.ts:15-41`); `/^\/c\/([^/?#]+)/` (`31.cafe-pages.ts:14`); `old-addresses.ts:8`; `media.delivery.ts:14`; Better Auth `ctx.path` equality (`identity.auth.ts:95-113`); human-check paths (`shared/utils/human-check.ts`).

**Tests**: 87 server test files (not scanned).

## UNSURE (from scanners)

- Whether Nitro's `routeRules` matching (and the router) treats paths case-sensitively in this build: the advisory's condition ("when routing is case-insensitive"). Phase 2 must settle this from the 4.6.2 release/advisory and the installed code.
- Whether the root `swr` rule and the deployed `headers` rule on `/c/*` merge as intended (not verified from Nitro source).
- Which `h3` copy Nitro/@nuxt/nitro-server bundles (the app pins `h3 1.15.11` directly; `request-body.ts` relies on h3 1 internals).
- Better Auth cookie attributes actually emitted (module defaults; not in repo code).
- `definePageMeta` count (~62) is derived, not counted directly; `MenuPage.vue:75` `useSeoMeta` keys not read.
- Generated `.nuxt/tsconfig.*.json` and `.nuxt/eslint.config.mjs` not read.
