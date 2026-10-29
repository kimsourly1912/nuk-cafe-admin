# Breaking changes — nuxt-4-6-2
Range: nuxt 4.6.1 → 4.6.2 (one patch release, with @nuxt/nitro-server, @nuxt/kit, @nuxt/schema, @nuxt/vite-builder at the same version); vue 3.5.43 → 3.5.44 (required by nuxt 4.6.2, `^3.5.44`).

Sources:
- [S1] Nuxt v4.6.2 release notes: https://github.com/nuxt/nuxt/releases/tag/v4.6.2 (2026-10-16).
- [S2] Vue CHANGELOG, 3.5.44 section: https://github.com/vuejs/core/blob/main/CHANGELOG.md.
- [S3] Package diff, `npm pack @nuxt/nitro-server@4.6.1` against `@4.6.2`: changed `dist/index.mjs`, `runtime/server.mjs`, `runtime/handlers/{renderer,island}.mjs`, `runtime/utils/{response,renderer/options}.mjs`, `request-types.d.mts`; new `runtime/plugins/route-rules.mjs`, `runtime/utils/route-rules.mjs`, `runtime/utils/island-head.mjs`.
- [S4] Installed code: `nitropack@2.13.4/dist/runtime/internal/route-rules.mjs:68-76`, `@nuxtjs/better-auth/dist/runtime/server/internal/nitro2.js:12,25`.
- [S5] Advisory (from `pnpm audit`): "Nuxt: Server-side route rules (`redirect`, `headers`, `proxy`, `ssr`) are skipped for case-variant paths when routing is case-insensitive"; nuxt and @nuxt/nitro-server `>=4.2.0 <4.6.2`, patched in `>=4.6.2`.

## Summary
- affected: 7 | not affected: 7 | unknown: 1
- breaking changes, deprecations or removals listed upstream: **none** (S1 and S2 contain fixes, a refactor, docs and chores only)
- official codemods: none
- required config changes: none

## Changes
| ID | Package | Version | Change | Affected | Where (files/count) | Fix type | Source |
|----|---------|---------|--------|----------|---------------------|----------|--------|
| C1 | @nuxt/nitro-server | 4.6.2 | Server route rules match paths **percent-decoded and case-folded** unless `router.options.sensitive` (the advisory fix) | yes | `nuxt.config.ts` routeRules (19) + `deployedSecurityRules()` (5); better-auth `auth: 'user'` gates (5) | none (verify) | S1 f6cfee52c, S3, S4, S5 |
| C2 | @nuxt/nitro-server | 4.6.2 | Router params read from the path h3 matched (raw/encoded segment mapping rewritten) | yes | SSR pages with params: `/c/[slug]/…`, `/table/[token]`, `/c/[slug]/orders/[id]` | none (verify) | S1 010f6b43d, S3 `runtime/server.mjs:169-191` |
| C3 | nuxt (nitro) | 4.6.2 | Server-island head follows `useHeadSafe` | no | no `<NuxtIsland>`, no `useHeadSafe` | — | S1 493565e99 |
| C4 | nuxt | 4.6.2 | Rooted paths resolved through the URL parser | unknown | possibly `navigateTo` (57) / router resolution; the notes don't name the API | none (verify) | S1 #36617 |
| C5 | nuxt, schema | 4.6.2 | Type generation: empty route types in shared context, server route types re-export `AnyFetchPath`, `nuxt/app` resolves to the app runtime, `experimental.typescriptPlugin` gets a default | yes | `app/utils/api.ts:1` (`AnyServerRouteMethod`, `TypedFetchOptions` from `#app`), `#app` type imports (3), `typecheck` | none (verify) | S1 #36576, #36610, #36587, #36561 |
| C6 | nuxt (nitro) | 4.6.2 | h3/Nitro auto-import presets disabled only when `nitroAutoImports` is off; unused h3 imports removed from the nuxt/server runtime | yes | server auto-imports in 213 handlers (`getRouterParam`, `createError`, `sendRedirect`, …); `nitroAutoImports` not set | none (verify) | S1 #36548, #36609 |
| C7 | nuxt (nitro) | 4.6.2 | Bundling: deps not inlined under absolute transpile dirs; unspecified dependencies no longer accessed | yes | Worker bundle (custom `server/cloudflare-entry.ts`, `nitro:init`/`nitro:config` hooks) | none (verify) | S1 #36540, #36541 |
| C8 | @nuxt/kit | 4.6.2 | Filename-derived handler method lowercased on Nitro v2 | no | all 208 route files already use lowercase suffixes | — | S1 #36567 |
| C9 | nuxt, nitro | 4.6.2 | String/array `appMiddleware` route rules normalised | no | `appMiddleware` not used | — | S1 #36565 |
| C10 | @nuxt/nitro-server | 4.6.2 | `render:response` listeners receive response headers | no | no `render:response` hook | — | S1 #36583, S3 |
| C11 | nuxt | 4.6.2 | Navigation fixes: error state kept on aborted/cancelled navigation, no page transition without a page to leave, middleware layout kept on deferred prerendered route, scroll offset for IDs starting with digits | yes | 5 global route middleware, 57 `navigateTo`, 8 `<Transition>` | none (verify) | S1 #36546, #36535, #36560, #36524 |
| C12 | @nuxt/vite-builder | 4.6.2 | Dev-server only: error overlay replay, SSR entry warm-up, inlined `vue` bundler build, null-byte CSS ids, asset URL helpers scoped to the build, SPA loading template location | no | dev server and build only; no `spaLoadingTemplate` | — | S1 #36611, #36615, #36569, #36549, #36591, #36536 |
| C13 | nuxt, kit | 4.6.2 | Server tsconfig kept when build dir relocated; module dirs with a dot kept in app tsconfig; module deps resolved from the declaring module | no | no relocated `buildDir`, no local modules | — | S1 #36494, #36331, #36542 |
| C14 | vue | 3.5.44 | 25 bug fixes, none marked breaking: watcher callbacks run inside another effect no longer track deps; a `once` watcher stops when its callback throws; only jobs queued by the root render are flushed; shallow collection semantics kept; async setup errors propagate in SSR; transition/transition-group fixes; `v-html` stringifies `0`/`false` | yes | `useApiQuery` (`watch`), `useState`/watchers across composables, 8 `<TransitionGroup>`, 8 `<Transition>`, SSR menu page; no `v-html`, `KeepAlive`, `Teleport`, `Suspense`, `v-memo` | none (verify) | S2 3.5.44 |
| C15 | nuxt (webpack, rspack) | 4.6.2 | Friendly-errors plugin inlined | no | the app builds with Vite | — | S1 #36568 |

## Details (only affected = yes or unknown)

### C1 — Route rules match case-folded, decoded paths (the advisory fix)
- what changed: 4.6.2 adds a Nitro plugin (`runtime/plugins/route-rules.mjs`, unshifted into `nitro.plugins`) that, in the `request` hook, resolves the rules for `event.path` after `decodeURI` (guarded: a malformed `%` falls back to the raw path) and, unless `router.options.sensitive`, `toLowerCase()`, against keys normalised the same way, and stores them in `event.context._nitro.routeRules` (S3). Nitro's own `getRouteRules(event)` returns that stored value (S4 `route-rules.mjs:68-76`), so the headers rules, Nuxt's renderer (`ssr`, `swr`) and `@nuxtjs/better-auth`'s server gate (`nitro2.js:25`, `getRouteRules(event)`) all see the folded result.
- how it affects this app: today a case-variant path skips its rule. The app sets no `sensitive` (`app/router.options.ts` has only `history`), so after the upgrade:
  - `/TABLE/<token>`, `/Reset-Password`, `/Verify-Email` get the token pages' `cache-control: no-store, no-transform` (today they don't, so Cloudflare could inject analytics into a page whose address carries a bearer token);
  - `/C/<slug>/admin…`, `/C/<slug>/counter…`, `/Platform…` get `ssr: false`; `/C/<slug>` gets the menu's `swr` and analytics-allowing CSP;
  - case-variant `/API/c/*/admin/**` etc. get the `auth: 'user'` gate and `/API/**` gets `no-store`. Whether such a path reaches an API handler at all depends on Nitro's handler router (case-sensitive radix3 in Nitro 2: expected not); every handler also checks permissions itself.
  - `/**` security headers already matched any case (`**`).
  - All rule keys in this app are lower-case ASCII, so no rule changes meaning for normal paths.
- fix: none needed; the upgrade is the fix. Verify on the built server: a case-variant `/TABLE/x` carries `cache-control: no-store, no-transform`; `/c/<slug>` still returns the `swr` page with its headers; `/api/c/<slug>/admin/me` without a session is still refused; normal paths unchanged.
- observation, not caused by this upgrade (out of scope, for a later step): app-side checks still compare paths case-sensitively, e.g. `server/middleware/31.cafe-pages.ts:14` (`/^\/c\//`) skips the cafe check for `/C/<slug>` while Vue's router matches it case-insensitively.
- risk: **high** (profile: authentication gate, server behavior, caching).

### C2 — Router params from the h3-matched path
- what changed: `runtime/server.mjs` rewrote how page params are mapped from the raw (encoded) URL to the matched route: it now strips the query from both, handles a trailing empty segment and an encoded `?` in the last segment, and no longer bails out when segment counts differ (S3).
- how it affects this app: SSR of pages with params (`/c/[slug]` menu, the `/c/[slug]/…` workspaces' first render, `/table/[token]` is client-only). Slugs and ids are plain ASCII here; encoded or trailing-slash forms (D208 already redirects trailing slashes) are the edge.
- fix: none; verify the SSR menu page and a `/c/<slug>/…` deep link, and a slug with a query string.
- risk: medium.

### C4 — Rooted paths through the URL parser
- what changed: "resolve rooted paths through URL parser" (#36617); the release notes don't say which function. Not found in the `@nuxt/nitro-server` diff, so it's in the `nuxt` package (app side).
- how it affects this app: possibly `navigateTo('/…')` (57 calls), `useTenantPath()` links, middleware redirects (`00.trailing-slash.global.ts`).
- fix: none expected; the e2e suite (navigation, redirects, trailing slash) is the check. If phase 4 needs certainty, read the `nuxt@4.6.2` diff for #36617.
- risk: low.

### C5 — Type generation
- what changed: four typing fixes (S1).
- how it affects this app: `app/utils/api.ts` imports `AnyServerRouteMethod`/`TypedFetchOptions` from `#app`; `typecheck` covers the rest.
- fix: none expected; `pnpm typecheck` must stay clean.
- risk: low.

### C6 — Server auto-imports
- what changed: h3/Nitro presets are now disabled only when `nitroAutoImports` is off; the nuxt/server runtime drops unused h3 imports.
- how it affects this app: server code relies on auto-imported h3 helpers; `nitroAutoImports` is not set, so they stay on. Explicit `h3` imports (4 files) are unaffected.
- fix: none; `typecheck` and `build` verify.
- risk: low.

### C7 — Bundling changes
- what changed: dependency inlining and "unspecified dependency" access changed in the Nitro build integration.
- how it affects this app: the Cloudflare Worker bundle with the custom entry (`server/cloudflare-entry.ts`) and the `nitro:init`/`nitro:config` hooks.
- fix: none expected; profile high-risk #8: `pnpm build:staging`, diff `.output/server/wrangler.json` against `upgrade/logs/baseline/wrangler.staging.json`, `wrangler deploy --dry-run` (baseline 10209.45 KiB / gzip 2043.07 KiB), local `wrangler dev` smoke test.
- risk: **high** (profile: Cloudflare entry).

### C11 — Navigation fixes
- what changed: four app-router fixes.
- how it affects this app: global middleware (auth, counter, platform, unsaved changes, trailing slash), `navigateTo`, page transitions.
- fix: none; the e2e suite (sign-in redirects, leave guard, Back closing overlays) verifies.
- risk: low.

### C14 — Vue 3.5.44
- what changed: bug fixes only (S2). The ones that touch this app's patterns: watcher callbacks that run inside another effect no longer collect dependencies (#15782); a `once` watcher stops when its callback throws (#15755); the scheduler flushes only jobs queued by the root render (#15757); transition/transition-group fixes (#15848, #15853); SSR async setup errors propagate (#15857).
- how it affects this app: `useApiQuery` and composables use `watch`; lists use `<TransitionGroup>` (D165 reorder motion).
- fix: none; unit tests and the full e2e suite verify.
- risk: low.

## Module compatibility
| Module | Current | Needed | Supports target? | Source |
|---|---|---|---|---|
| @nuxt/ui | 4.12.0 | 4.12.0 | yes: no nuxt peer range (uses @nuxt/kit) | installed `package.json` |
| @nuxthub/core | 0.10.8 | 0.10.8 | yes: no nuxt peer range | installed `package.json` |
| @nuxtjs/better-auth | 0.3.7 | 0.3.7 | yes: peers only @nuxt/test-utils, @nuxthub/core; reads rules through `getRouteRules(event)`, which 4.6.2 feeds (S4) | installed `package.json`, S4 |
| @nuxt/eslint | 1.17.0 | 1.17.0 | yes: no nuxt peer range | installed `package.json` |
| @nuxt/test-utils | 4.3.2 | 4.3.2 | yes: no nuxt peer range | installed `package.json` |

## Unknowns that need my decision
- None blocking. C4 is checked by the existing e2e suite; if it fails, read the `nuxt@4.6.2` #36617 diff.
- For later, outside this upgrade: whether to make the app's own path checks (e.g. `31.cafe-pages.ts`) case-insensitive to match the router (C1 observation).
