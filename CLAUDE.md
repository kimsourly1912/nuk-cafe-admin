# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Admin portal for NUK Cafe staff to manage the menu (categories, menu items, schedules), rewards, vouchers, banners, customers, staff and orders. **Frontend only.** It consumes an external Spring Boot API. Stack: Nuxt 4 (SPA mode), Nuxt UI v4 + Tailwind v4, Valibot, SDK generated from OpenAPI by Hey API. English-only UI.

The code is **organized by feature** under `app/features/`. `app/features/categories/` is the **reference feature**: copy its patterns for every new feature (see "Adding a feature").

## Commands

Package manager is **pnpm**.

```bash
pnpm dev                                  # http://localhost:3000, /api proxied to the dev backend
pnpm api:generate                         # regenerate app/generated/api from the backend OpenAPI spec
pnpm lint / pnpm lint:fix                 # ESLint also does formatting (no Prettier) and enforces feature boundaries
pnpm typecheck                            # vue-tsc via nuxt typecheck
pnpm test                                 # all Vitest projects
pnpm vitest run --project unit            # one project: unit | nuxt | e2e
pnpm vitest run app/features/categories   # one feature's tests
pnpm vitest run -t "refreshes once"
```

Before finishing a change, run `pnpm lint`, `pnpm typecheck` and `pnpm test`. If lint or typecheck complains about missing `.nuxt/*` files, run `pnpm nuxt prepare`.

## Feature architecture

```
app/
├── features/<feature>/          # everything specific to one business area
│   ├── index.ts                 # PUBLIC API: the only file other code may import
│   ├── navigation.ts            # this feature's sidebar entry (exported via index.ts)
│   ├── components/
│   │   ├── <Feature>ListPage.vue    # private screen, rendered by a route file
│   │   ├── <Feature>FormModal.vue   # private
│   │   └── <Feature>Select.vue      # public building block (picker for other features)
│   ├── composables/
│   │   ├── use<Feature>s.ts         # private: list + mutations
│   │   └── use<Feature>Options.ts   # public: data for pickers
│   ├── schemas/<feature>-form.ts    # Valibot form schema + form<->request mapping (pure, unit-tested)
│   └── tests/*.test.ts
├── pages/                       # THIN route files: definePageMeta + render <Feature>Page
├── components/ composables/ utils/   # SHARED across features only (auto-imported)
├── layouts/ middleware/ plugins/ types/   # app shell
└── generated/api/               # generated SDK (shared, never edit)
```

### Rules (the boundary rules are enforced by ESLint in `eslint.config.mjs`)

1. **Everything specific to one feature lives in `app/features/<feature>/`.** Only code used by two or more features, or by the app shell, goes in the root `components/`, `composables/` or `utils/`. Build it inside the feature first, and move it to the root when a second feature needs it.
2. **`index.ts` exports only building blocks:** pickers (`CategorySelect`), display components, option composables (`useCategoryOptions`), types and `navigation`. **Never export pages or forms from `index.ts`.** Otherwise features that use each other (products ↔ schedules) would import each other's screens and create cycles.
3. **Cross-feature imports go through the public API only:** `import { CategorySelect } from '~/features/categories'`. Deep imports (`~/features/x/composables/...`) and relative paths that leave the feature (`../../x`) are lint errors.
4. **Public building blocks must not import other features.** This keeps the dependency graph one level deep, so no cycles can form. Screens (pages, forms) may import other features' public APIs.
5. **Inside a feature, use relative imports** (`../composables/useCategories`). Feature code is *not* auto-imported. Root shared code *is* auto-imported everywhere (`unwrap`, `getErrorMessage`, `invalidate`, `usePaginatedQuery`, `useConfirm`, `StatusBadge`, `STATUS_ITEMS`, `ANY`, ...).
6. **Route files in `app/pages/` stay thin.** They hold `definePageMeta` plus one `<Feature>…Page.vue` from the feature (the only deep import pages are allowed). Routes stay discoverable in one place.
7. **Name feature folders after backend resources**, so a folder maps to SDK functions and URLs: `categories`, `products` (shown as "Menu items" in the UI), `schedules`, `rewards` (reward categories live inside it: they're not menu categories), `vouchers`, `banners`, `customers`, `staff`, `orders`, `auth`.

### Cross-feature relationships (from the API)

- A menu item (`ProductRecordCreation`) has `categoryId` (required) and `scheduleIds[]`, so the products form uses `CategorySelect` and `ScheduleSelect`.
- A schedule (`ScheduleCreateRequest`) has `items[]` (product ids), so the schedules form uses a `ProductSelect` from products. This is the bidirectional case that rule 2 exists for.
- A category has an optional `mainCategoryId` (main vs sub). The category form uses its own `CategorySelect type="MAIN"`.

### Data freshness

- `useAsyncData` keys are **namespaced by feature**: `<feature>:<name>` (`categories:list`, `categories:options:MAIN:all`).
- After a mutation, call `invalidate('<own feature>', '<affected feature>', ...)` (`app/utils/invalidate.ts`). It refetches every loaded key with those prefixes, so a feature never imports another feature's keys. Example: category mutations call `invalidate('categories', 'products')` because product lists show category names.

## Backend API facts (verified against the dev API)

- Spec: `https://dev-api.nukcafe.co/nukcafe/api/v2/api-docs`. The admin portal uses only `/staff/**` and `/admin/**` (filtered in `openapi-ts.config.ts`).
- **Every response is an envelope** `{ data, success, msg, reason }` (`ResponseMsg*` types). `msg` is a code (`NC1000`, `LOGIN_FAILED`), `reason` is human-readable.
- **Failures can arrive as HTTP 200 with `success: false`** (e.g. bad login). The API layer turns these into errors, so feature code never checks `success`.
- Pagination: query `page` (**0-based**) + `size`. Response `data` is `{ content, totalElements, totalPages, currentPage, pageSize, hasNext, hasPrevious }`.
- Most resources share `status: 'ACTIVE' | 'INACTIVE'` and i18n maps `nameI18n` / `descriptionI18n` (`en`, `zh-HK`, `km`).
- Auth is **HttpOnly cookies** (`staff_access_token`, `staff_refresh_token`) set by `/staff/auth/login`. Endpoints: `login`, `session` (GET, returns `StaffSessionDto` with `groups`), `refresh`, `logout`. The frontend never reads or stores tokens.
- Cookies are `SameSite=Lax` with no `Domain`, so the browser must see the API as same-site. Dev: requests go through the Nitro `devProxy` at `/api` (`nuxt.config.ts`), which also rewrites `Origin` because the backend's CORS allowlist rejects arbitrary localhost ports. Prod: host the portal on the same site as the API (e.g. `admin.nukcafe.co`) and set `NUXT_PUBLIC_API_BASE` (see `.env.example`).
- The backend's names are imperfect: `operationId`s are auto-suffixed (`createCategory1`, `update_2`, `getById_1`), and every response field is optional because Springdoc doesn't mark `required`. Find an SDK function by its URL: search `app/generated/api/sdk.gen.ts` for `url: '/staff/...'`.

## Request pipeline

```
feature component
  → feature composable                         useAsyncData + unwrap()
    → generated SDK function (sdk.gen.ts)      typed params/body/response
      → Hey API ofetch client, configured in app/plugins/api.ts (baseUrl, credentials: 'include')
        → createApiFetch (app/utils/api-fetch.ts)   envelope check → ApiError; 401 → refresh once → retry
          → ofetch → /api (dev proxy) → backend
```

- `app/generated/api/`: **generated, never edit by hand, never lint**. Contains `sdk.gen.ts` (one function per endpoint), `types.gen.ts` (request/response types), `valibot.gen.ts` (`v<SchemaName>` schemas). Regenerate with `pnpm api:generate` after backend changes, then fix any renamed operationIds with typecheck.
- The client is `@hey-api/client-ofetch` with `throwOnError: true`: SDK calls resolve to `{ data: <envelope> }` or throw. We don't use `@hey-api/client-nuxt`: it's beta, and its composable types fail to compile against Nuxt 4.5.
- `unwrap(sdkCall(...))` returns the envelope's `data`. Use it for every SDK call.
- Token refresh is single-flight: concurrent unauthorized errors share one `/staff/auth/refresh`. If refresh fails, `clearSession()` runs and the watcher in `plugins/api.ts` redirects to `/login?redirect=...`.
- Requests time out after 30s (`timeout` in `plugins/api.ts`).

## Error handling

The backend is **inconsistent**: most failures come back as **HTTP 200 + `success: false`** (validation, not found, wrong login, even "unknown path"), 401 is a real HTTP status, and gateway/CORS/crash errors may not be the envelope at all (plain text, HTML, Spring's default JSON). `app/utils/api-error.ts` hides all of that:

- **Every failure becomes one `ApiError`**, thrown by the API layer: `kind` (what went wrong), `status` (0 if there was no response, 200 for `success:false`), `code` (backend `msg`), `message` (**always safe to show**), `detail` (raw technical text, for logs) and `retryable`.
- **The backend code wins over the HTTP status** when classifying. `API_ERROR_CODES` maps known codes to kinds: `NC0001` → validation, `NC0011`/`NC0014` → not_found, `NC1000` → unauthorized (triggers a refresh even when sent with HTTP 200), `NC0000` → unknown. **Add new codes there as you meet them.** Unknown codes sent with HTTP 200 become `business`.
- **The message shown to users:** the backend `reason` for user-facing kinds (business, validation, not_found, conflict, forbidden). Otherwise a friendly fallback from `API_ERROR_MESSAGES`: technical codes (`NC0000`, e.g. "No static resource…"), 5xx, HTML/plain-text bodies, network and timeout. Unexpected JS errors never leak their message.
- `ApiError.from(anything)` normalizes any thrown value. It walks the `cause` chain because `useAsyncData`'s NuxtError replaces its cause with the ApiError's own cause. It detects ofetch errors by name (not `instanceof`), because Vite can load two copies of ofetch.

How to use it in UI code:

| Situation | Use |
|---|---|
| Mutation in a component (save, delete) | `try { … notify.success('Saved') } catch (e) { notify.error('Could not save category', e) }` with `useNotify()` |
| Failed load (`useAsyncData` error) | `<ApiErrorAlert v-if="error" :error="error" title="Could not load …" @retry="refresh()" />` |
| Inline form error (e.g. login) | `getErrorMessage(error)` in a `UAlert` |
| Branch on the failure | `ApiError.from(e).kind === 'not_found'` (never compare status or message strings) |

- `useNotify().error` skips `aborted` and `unauthorized` errors (the session redirect already handles those) and logs `detail` to the console in dev.
- `plugins/errors.ts` is a safety net that toasts errors nobody caught (`vue:error`, unhandled `ApiError` rejections). Don't rely on it: catch at the call site.
- `app/error.vue` renders fatal errors (unknown routes, `showError()`).
- Don't use `useToast()` directly for API results, and don't show `error.message` from anything that isn't an `ApiError`.
- The backend's validation errors are a single string (`"Required fields are missing: password, username"`), not per-field, so show them as a toast or form-level alert. Field-level rules belong in the Valibot form schema.

## Auth & app shell

- `app/features/auth/` exposes `useAuth()`: `user` (state, no tokens), `isLoggedIn`, `fetchSession`, `login`, `logout`. The shell (`middleware/auth.global.ts`, `plugins/api.ts`, `layouts/default.vue`) imports it from `~/features/auth`.
- The middleware protects **every page by default**. Opt out with `definePageMeta({ public: true })` (typed in `app/types/page-meta.d.ts`).
- `ssr: false`: the app is a pure SPA because only the browser has the auth cookies. Don't add server routes or SSR-dependent code.
- `app/layouts/default.vue` is the Nuxt UI dashboard shell. The sidebar is `app/utils/navigation.ts`, which groups and orders each feature's exported `navigation` entry.
- Every page component renders a `UDashboardPanel`: `UDashboardNavbar` (title, `UDashboardSidebarCollapse`, actions in `#right`), an optional `UDashboardToolbar` with filters in `#left`, and content in `#body`.

## Shared building blocks (root, auto-imported)

| What | Where | Use for |
|---|---|---|
| `usePaginatedQuery(filters)` | `composables/` | List state: 1-based `page` for `UPagination`, `query` with the 0-based API page, resets page on filter change, strips `ANY`/'' |
| `ANY`, `toApiQuery` | `utils/query.ts` | "All" option in filter selects (`USelect` can't hold `undefined`) |
| `invalidate(...features)` | `utils/invalidate.ts` | Refetch data after mutations |
| `StatusBadge`, `STATUS_ITEMS`, `STATUS_FILTER_ITEMS`, `Status` | `components/`, `utils/status.ts` | ACTIVE/INACTIVE display, form select and filter select |
| `useConfirm()` | `composables/` | `await confirm({ title, danger: true })` resolves to `boolean` |
| `unwrap`, `ApiError`, `getErrorMessage` | `utils/api*.ts` | API calls and errors (see "Error handling") |
| `useNotify()` | `composables/` | Success/error toasts for mutations |
| `ApiErrorAlert` | `components/` | Load-error alert with Retry |

Expected to be promoted to the root when the first two features need them: `ImageUpload` (products, rewards, banners and vouchers all have upload endpoints) and `I18nFields` (for `nameI18n` / `descriptionI18n`).

## Adding a feature (e.g. products)

Mirror `app/features/categories/` file by file:

1. **Endpoints:** find them in `app/generated/api/sdk.gen.ts` by URL. If they're missing or stale, run `pnpm api:generate`.
2. **`composables/use<Feature>s.ts` (private):**
   - `use<Feature>List(query)`: `useAsyncData('<feature>:list', () => unwrap(sdkFn({ query: toValue(query) })), { watch: [() => ({ ...toValue(query) })] })`.
   - `use<Feature>Mutations()`: `create` / `update` / `remove` call the SDK through `unwrap`, then `invalidate('<feature>', ...affected)`.
   - Only data access goes here: no toasts, no UI.
3. **`composables/use<Feature>Options.ts` + `components/<Feature>Select.vue` (public):** add these if other features need to pick this resource. Key the options per filter. The select hides the `USelect` sentinel for "none" (see `CategorySelect`).
4. **`schemas/<feature>-form.ts`:** the Valibot schema with user-facing messages (generated request schemas carry no rules). `to<Feature>Form(existing?)` builds the initial form state. `to<Feature>Request(form, existing?)` builds the request body and **copies over fields the form doesn't edit** (`nameI18n`, `sortOrder`, ...) so the PUT doesn't wipe them. Unit-test it in `tests/`.
5. **`components/<Feature>FormModal.vue`:** opened with `useOverlay().create(...)`. It calls the mutation, reports the result with `useNotify()`, and emits `close(true)`. It pulls in other features' pickers from their `index.ts`.
6. **`components/<Feature>ListPage.vue`:** `usePaginatedQuery` + list composable, `UTable` with `#<column>-cell` slots, `<ApiErrorAlert>` on load error, row actions through `UDropdownMenu`, and delete through `useConfirm()`.
7. **`navigation.ts` + `index.ts`:** export the sidebar entry and the public building blocks, then add the entry to a group in `app/utils/navigation.ts`.
8. **Route file** `app/pages/<feature>/index.vue`: import and render `<Feature>ListPage.vue`, nothing else.

## Tests

`vitest.config.ts` defines three projects:
- **unit** (Node, no Nuxt runtime): `app/features/*/tests/**/*.test.ts` and `test/unit/**`. Test pure code such as schemas, form mapping and utils. Files under test must import their dependencies explicitly, not through auto-imports.
- **nuxt** (Nuxt environment via `@nuxt/test-utils`): `app/features/*/tests/**/*.nuxt.test.ts` and `test/nuxt/**`.
- **e2e**: `test/e2e/**` (`@nuxt/test-utils/e2e` + `playwright-core`).

Shared code tests live in `test/` (e.g. `test/unit/api-fetch.test.ts` covers the envelope, refresh and retry logic).

## Conventions

- Prefer Nuxt-native tools (`useAsyncData`, `useState`, `useRuntimeConfig`, route middleware) before adding a library. There is no Pinia: shared state is `useState` inside a composable.
- Import SDK functions and types from `~/generated/api`, and Valibot as `import * as v from 'valibot'`.
- `USelect` cannot hold an empty or `undefined` value. Use `ANY` for "all" filters and let the `<Feature>Select` components handle "none".
- The UI chrome is English only. Translatable content fields (`nameI18n`, ...) are data, preserved on update.
