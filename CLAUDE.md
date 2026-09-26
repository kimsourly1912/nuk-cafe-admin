# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Admin portal for NUK Cafe staff to manage the menu (categories, products), schedules, rewards, vouchers, banners, etc. **Frontend only.** It consumes an external Spring Boot API. Stack: Nuxt 4 (SPA mode), Nuxt UI v4 + Tailwind v4, Valibot, SDK generated from OpenAPI by Hey API. English-only UI.

`app/pages/categories/` is the **reference feature**. Copy its patterns for every new feature (see "Adding a feature").

## Commands

Package manager is **pnpm**.

```bash
pnpm dev                                  # http://localhost:3000, /api proxied to the dev backend
pnpm api:generate                         # regenerate app/generated/api from the backend OpenAPI spec
pnpm lint / pnpm lint:fix                 # ESLint also does formatting (no Prettier)
pnpm typecheck                            # vue-tsc via nuxt typecheck
pnpm test                                 # all Vitest projects
pnpm vitest run --project unit            # one project: unit | nuxt | e2e
pnpm vitest run test/unit/api-fetch.test.ts
pnpm vitest run -t "refreshes once"
```

Before finishing a change, run `pnpm lint`, `pnpm typecheck` and `pnpm test`. If lint or typecheck complains about missing `.nuxt/*` files, run `pnpm nuxt prepare`.

## Backend API facts (verified against the dev API)

- Spec: `https://dev-api.nukcafe.co/nukcafe/api/v2/api-docs`. The admin portal uses only `/staff/**` and `/admin/**` (filtered in `openapi-ts.config.ts`).
- **Every response is an envelope** `{ data, success, msg, reason }` (`ResponseMsg*` types). `msg` is a code (`NC1000`, `LOGIN_FAILED`), `reason` is human-readable.
- **Failures can arrive as HTTP 200 with `success: false`** (e.g. bad login). The API layer turns these into errors, so feature code never checks `success`.
- Pagination: query `page` (**0-based**) + `size`. Response `data` is `{ content, totalElements, totalPages, currentPage, pageSize, hasNext, hasPrevious }`.
- Auth is **HttpOnly cookies** (`staff_access_token`, `staff_refresh_token`) set by `/staff/auth/login`. Endpoints: `login`, `session` (GET, returns `StaffSessionDto` with `groups`), `refresh`, `logout`. The frontend never reads or stores tokens.
- Cookies are `SameSite=Lax` with no `Domain`, so the browser must see the API as same-site. Dev: requests go through the Nitro `devProxy` at `/api` (`nuxt.config.ts`), which also rewrites `Origin` because the backend's CORS allowlist rejects arbitrary localhost ports. Prod: host the portal on the same site as the API (e.g. `admin.nukcafe.co`) and set `NUXT_PUBLIC_API_BASE` (see `.env.example`).
- The backend's names are imperfect: `operationId`s are auto-suffixed (`createCategory1`, `update_2`, `getById_1`), and every response field is optional because Springdoc doesn't mark `required`. Find an SDK function by its URL: search `app/generated/api/sdk.gen.ts` for `url: '/staff/...'`.

## Architecture

### Request pipeline

```
page/component
  → feature composable (app/composables/use<Feature>.ts)      useAsyncData + unwrap()
    → generated SDK function (app/generated/api/sdk.gen.ts)   typed params/body/response
      → Hey API ofetch client, configured in app/plugins/api.ts (baseUrl, credentials: 'include')
        → createApiFetch (app/utils/api-fetch.ts)             envelope check → ApiError; 401 → refresh once → retry
          → ofetch → /api (dev proxy) → backend
```

- `app/generated/api/`: **generated, never edit by hand, never lint**. Contains `sdk.gen.ts` (one function per endpoint), `types.gen.ts` (request/response types), `valibot.gen.ts` (`v<SchemaName>` schemas). Regenerate with `pnpm api:generate` after backend changes, then fix any renamed operationIds with typecheck.
- The client is `@hey-api/client-ofetch` with `throwOnError: true`: SDK calls resolve to `{ data: <envelope> }` or throw. We don't use `@hey-api/client-nuxt`: it's beta, and its composable types fail to compile against Nuxt 4.5.
- `unwrap(sdkCall(...))` (`app/utils/api.ts`) returns the envelope's `data`. Use it for every SDK call.
- **All API errors are `ApiError`** (`app/utils/api-error.ts`) with `status`, `code` (backend `msg`) and `message` (backend `reason`). Show them with `getErrorMessage(error)`.
- Token refresh is single-flight: concurrent 401s share one `/staff/auth/refresh`. If refresh fails, `useAuth().clearSession()` runs and the watcher in `plugins/api.ts` redirects to `/login?redirect=...`.

### Auth & routing

- `useAuth()` (`app/composables/useAuth.ts`): `user` (state, no tokens), `isLoggedIn`, `fetchSession`, `login`, `logout`.
- `app/middleware/auth.global.ts` protects **every page by default**. Opt out with `definePageMeta({ public: true })` (typed in `app/types/page-meta.d.ts`). Logged-in users are redirected away from `/login`.
- `ssr: false`: the app is a pure SPA because only the browser has the auth cookies. Don't add server routes or SSR-dependent code.

### Layout & UI

- `app/layouts/default.vue`: Nuxt UI dashboard shell (`UDashboardGroup` + collapsible `UDashboardSidebar`). Sidebar entries come from `navigationItems` in `app/utils/navigation.ts`.
- `app/layouts/auth.vue`: centered layout for the login page.
- Every page renders a `UDashboardPanel` with `UDashboardNavbar` (title, `UDashboardSidebarCollapse`, actions in `#right`), an optional `UDashboardToolbar` (filters), and content in `#body`.
- Modals are opened programmatically with `useOverlay()`. The modal component emits `close` with its result. For confirmations, use `useConfirm()`, which returns `Promise<boolean>` (`app/components/ConfirmDialog.vue`).
- Theme colors live in `app/app.config.ts`. Icons: Lucide via `i-lucide-*`.

## Adding a feature (e.g. Products, Rewards, Schedules)

Follow the Categories implementation file by file:

1. **Find the endpoints** in `app/generated/api/sdk.gen.ts` (search by URL) and their types in `types.gen.ts`. If they're missing or stale, run `pnpm api:generate`.
2. **Composable** `app/composables/use<Feature>.ts` (see `useCategories.ts`):
   - Define `KEYS` for its `useAsyncData` keys (`'<feature>:list'`, ...).
   - `use<Feature>List(query)`: `useAsyncData(KEYS.list, () => unwrap(sdkFn({ query: toValue(query) })), { watch: [() => ({ ...toValue(query) })] })`.
   - `use<Feature>Mutations()`: `create` / `update` / `remove` call the SDK through `unwrap`, then `refreshNuxtData(Object.values(KEYS))`.
   - Only data access goes here: no toasts, no UI.
3. **List page** `app/pages/<feature>/index.vue` (see `pages/categories/index.vue`):
   - Filters as refs, reset `page` to 1 when a filter changes, and convert the 1-based `UPagination` page to the 0-based API page.
   - `UTable` with `TableColumn<ResponseType>[]` and `#<column>-cell` slots, plus a row actions `UDropdownMenu`.
   - Handle `error` with a `UAlert` and a Retry button. Pass `loading` to `UTable`.
   - Deletion: `useConfirm()`, then the mutation, then a toast.
4. **Form modal** `app/components/<feature>/<Feature>FormModal.vue`. Use a **singular** folder name matching the file prefix, so Nuxt names the component `<Feature>FormModal`:
   - Define a Valibot `schema` in the component with user-facing messages, because the generated request schemas carry no rules. Build the request body typed as the generated request type (e.g. `CategoryRecordCreation`).
   - When editing, **pass through fields the form doesn't edit** (e.g. `nameI18n`, `sortOrder`) so the PUT doesn't wipe them.
   - The modal calls the mutation, shows a success or error toast, and emits `close(true)` on success.
5. **Navigation**: add an entry to `app/utils/navigation.ts`.
6. **Tests**: put pure logic in `app/utils/` with explicit relative imports, and unit-test it in `test/unit/`.

## Conventions

- Prefer Nuxt-native tools (`useAsyncData`, `useState`, `useRuntimeConfig`, route middleware) before adding a library. There is no Pinia: shared state is `useState` inside a composable.
- Auto-imports cover `app/composables/*` and `app/utils/*` (top level only). Files meant for unit tests (`app/utils/api*.ts`) import their siblings explicitly so they run outside Nuxt.
- Import SDK functions and types from `~/generated/api`, and Valibot as `import * as v from 'valibot'`.
- `USelect` cannot hold an empty or `undefined` value. Use a sentinel (`'ALL'`, or `0` for "no parent") and map it to `undefined` before calling the API.
- The backend returns i18n content fields (`nameI18n`, languages `en`, `zh-HK`, `km`). The UI chrome itself is English only.

## Tests

`vitest.config.ts` defines three projects, and a test runs only if it is in the matching folder:
- `test/unit/*.test.ts`: Node, no Nuxt runtime (e.g. `api-fetch.test.ts` covers the envelope, refresh and retry logic).
- `test/nuxt/*.test.ts`: Nuxt environment via `@nuxt/test-utils` (auto-imports and components available).
- `test/e2e/*.test.ts`: `@nuxt/test-utils/e2e` with `playwright-core`.
