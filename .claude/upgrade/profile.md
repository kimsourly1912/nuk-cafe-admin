# Upgrade profile — this project

> Project-specific facts the generic `/upgrade-*` commands need.
> Edit this file when the stack changes. Keep it short and factual.

## Stack

- Framework: Nuxt 4 (app in `app/`, server in `server/`, shared code in `shared/`)
- UI: Nuxt UI (+ Tailwind CSS)
- Server runtime: Nitro (h3) on Cloudflare Workers via NuxtHub
- Data: Cloudflare D1 with Drizzle ORM (migrations: see `drizzle.config.*`)
- Auth: Better Auth (server-side sessions, HttpOnly cookies)
- Language: TypeScript

<!-- Fix any line above that is not true for this repo. -->

## Key packages to always record (Phase 0)

nuxt, @nuxt/ui, nitropack / nitro, h3, vue, vue-router, vite, tailwindcss,
typescript, vue-tsc, @nuxthub/core, better-auth, drizzle-orm, drizzle-kit,
wrangler, every `@nuxt/*` and `nuxt-*` module, Node version.

## Folders to skip when scanning

node_modules, .nuxt, .output, dist, .data, .wrangler, upgrade/logs, lockfiles

## Scan areas (Phase 1 — one `upgrade-scanner` per area, run in parallel)

Use only the areas relevant to the packages being upgraded.

### A. Dependencies & config (always)
Scan `package.json`, `nuxt.config.*`, `app.config.*`, `app/app.config.*`,
`tsconfig*.json`, `wrangler.*`, `drizzle.config.*`, `vitest.config.*`,
`eslint.config.*`, `layers/`, `modules/`, and the main CSS entry
(`@import "tailwindcss"`, `@import "@nuxt/ui"`, `@theme`, `@source`).
Report: modules, `future`/`compatibilityVersion`/`experimental` flags,
`nitro` options, `runtimeConfig` keys (names only, never values), `routeRules`,
`ui` options, `app.config.ui` keys, `colorMode`, `icon`, `hub` config, layers, aliases.

### B. UI library usage (when upgrading Nuxt UI / Tailwind)
Every Nuxt UI component tag (`U*`) in `.vue` files: count, files, props, slots
and events used. Composables `useToast`, `useOverlay`, `defineShortcuts`,
`useColorMode`. Every `:ui="..."` and `app.config.ts` `ui:` override.

### C. App/framework APIs (when upgrading Nuxt / Vue / vue-router)
`useFetch`, `useAsyncData`, `$fetch`, `useLazyFetch`, `refreshNuxtData`,
`clearNuxtData`, `useState`, `useCookie`, `useRequestHeaders`, `useRequestEvent`,
`navigateTo`, `defineNuxtRouteMiddleware`, `addRouteMiddleware`, `definePageMeta`
keys, `useHead`/`useSeoMeta`, `defineNuxtPlugin` options, `useNuxtApp`, `callOnce`,
`useRuntimeConfig`, `<NuxtLayout>`, `<NuxtPage>`, `<ClientOnly>`, `<NuxtIsland>`,
`Lazy*` components, imports from `#imports`, `#app`, `#build`.

### D. Server, runtime & auth (when upgrading Nuxt / Nitro / h3 / NuxtHub / Better Auth)
In `server/` and `shared/`: every route file (method + path); `defineEventHandler`,
`defineCachedEventHandler`, h3 helpers (`readBody`, `readValidatedBody`, `getQuery`,
`getValidatedQuery`, `getRouterParam`, `getCookie`, `setCookie`, `deleteCookie`,
`createError`, `sendRedirect`, `setResponseStatus`, `getHeader`, `H3Event`),
server middleware, `defineNitroPlugin`, `useStorage`, `hubDatabase`, `hubKV`,
`hubBlob`, `useRuntimeConfig(event)`, `event.context.cloudflare`, Better Auth
setup (`betterAuth(`, `auth.handler`, `getSession`, plugins, cookie options),
every import from `h3`, `nitropack`, `nitro`, `ofetch`, `unstorage`.

### E. Data layer (when upgrading Drizzle / D1 / NuxtHub)
Drizzle schema files, `drizzle(` setup, query builder patterns used
(`select/insert/update/delete`, `with`, transactions/batch), migration folder
and how migrations are applied, every import from `drizzle-orm/*`.

## Official sources (Phase 2)

- Nuxt: nuxt.com/docs (upgrade guide), nuxt.com/blog (release posts), github.com/nuxt/nuxt/releases
- Nuxt UI: ui.nuxt.com (migration guides, component docs), github.com/nuxt/ui/releases; Nuxt UI MCP server at ui.nuxt.com/mcp if connected
- Nitro / h3: nitro.build, github.com/nitrojs/nitro/releases, github.com/h3js/h3/releases
- NuxtHub: hub.nuxt.com/docs, github.com/nuxt-hub/core/releases
- Better Auth: better-auth.com/docs, github.com/better-auth/better-auth/releases
- Drizzle: orm.drizzle.team/docs, github.com/drizzle-team/drizzle-orm/releases
- Anything else: the package's own repo releases and CHANGELOG

## High-risk areas (always `risk: high`, reviewed first in Phase 5)

1. Authentication: Better Auth handler mounting, session lookup, cookie options
   (HttpOnly, Secure, SameSite, path, domain), refresh-token rotation and reuse detection,
   CSRF/origin checks.
2. Authorization: default deny, centralized policies, server-side checks on every route.
3. Data scoping: every domain query scoped by `userId` / tenant.
4. Concurrency: `expectedRevision` checks and `409 Conflict` on stale edits.
5. Server behavior: route matching, methods, status codes, error shape,
   validation, caching (`routeRules`, cached handlers), middleware order.
6. Runtime config & secrets: nothing secret moves into `public`.
7. Database: bindings, migrations, query behavior changes.
8. Cloudflare entry (custom entry/error handler via Nitro hooks): before merge, `pnpm build:staging`,
   diff `.output/server/wrangler.json` against the pre-upgrade copy, `wrangler deploy --dry-run`, and a local
   `wrangler dev` smoke test. Do not downgrade this to optional.

## Manual smoke test (after every upgrade)

login, logout, session refresh, expired session, one protected route as an
unauthorized user, one CRUD flow, one stale edit (expect 409), main dashboard
pages, one form with validation, dark mode.
