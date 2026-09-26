# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, and others) working in this repository. This is the **single source of truth**. `CLAUDE.md` only imports this file.

## Resuming work: read first

1. **[docs/progress.md](docs/progress.md)**: what's done, what's next, open questions for the backend team, and how well each part has been verified. Start every session here.
2. **[docs/decisions.md](docs/decisions.md)**: why things are the way they are. Read the relevant entry **before changing** a pattern that looks odd. Most of them work around a verified backend or tooling quirk.
3. **[docs/reference/](docs/reference/README.md)**: API reference for every shared composable, util and component (`useMutation`, `useApiQuery`, `ApiError`, …) with types, options and examples. Check it before using or changing a shared API. **[App-wide behavior](docs/reference/app-behavior.md)** (tab titles, refresh on tab focus, offline, leave guards, session loss) and **[Forms: unsaved changes](docs/reference/forms.md)** list every edge case those handle.
4. **[docs/feature-standard.md](docs/feature-standard.md)**: how every new feature is planned, built and verified (planning template, list/form/picker behavior, definition of done). **Read it before starting a feature.**
5. The rest of this file: rules and recipes.

**Keep these documents current as part of your work:**
- Finished or started something → update `docs/progress.md` (status, next steps, and what you verified and how).
- Made or changed an architectural decision → add or amend an entry in `docs/decisions.md`.
- Changed a convention, rule or shared building block → update this file.
- Added or changed a shared API (or a feature's public `index.ts`) → update its page in `docs/reference/` (examples must compile).
- Found or handled an **edge case** (a browser quirk, a backend inconsistency, a timing issue) → add it to the case table of the page it belongs to (`app-behavior.md`, `forms.md`, `data-fetching.md`, …) with how it's handled and which test covers it. Test pitfalls go in `docs/progress.md` → "How to verify".

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
pnpm test:unit / pnpm test:e2e            # unit+nuxt only (seconds) / e2e only (about a minute, builds the app)
pnpm vitest run --project unit            # one project: unit | nuxt | e2e
pnpm vitest run app/features/categories   # one feature's tests
pnpm vitest run -t "refreshes once"
```

Before finishing a change, run `pnpm lint`, `pnpm typecheck` and `pnpm test`. CI (`.github/workflows/ci.yml`) runs the same on every push to `main` and every pull request.

Commit messages: say what changed in the subject (`Add cross-tab logout`, `Fix open redirect after login`), not `new`. The history is how the team finds when something broke. If lint or typecheck complains about missing `.nuxt/*` files, run `pnpm nuxt prepare`.

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
6. **Route files in `app/pages/` stay thin.** They hold `definePageMeta` (always with a `title` for the browser tab) plus one `<Feature>…Page.vue` from the feature (the only deep import pages are allowed). Routes stay discoverable in one place.
7. **Name feature folders after backend resources**, so a folder maps to SDK functions and URLs: `categories`, `products` (shown as "Menu items" in the UI), `schedules`, `rewards` (reward categories live inside it: they're not menu categories), `vouchers`, `banners`, `customers`, `staff`, `orders`, `auth`.

### Cross-feature relationships (from the API)

- A menu item (`ProductRecordCreation`) has `categoryId` (required) and `scheduleIds[]`, so the products form uses `CategorySelect` and `ScheduleSelect`.
- A schedule (`ScheduleCreateRequest`) has `items[]` (product ids), so the schedules form uses a `ProductSelect` from products. This is the bidirectional case that rule 2 exists for.
- A category has an optional `mainCategoryId` (main vs sub). The category form uses its own `CategorySelect type="MAIN"`.

### Data freshness

- Query keys are **namespaced by feature**: `<feature>:<name>` (`categories:list`, `categories:options:MAIN:all`). `useApiQuery` warns in dev when a key isn't namespaced.
- Mutations declare `invalidate: ['<own feature>', '<affected feature>']`. The same invalidation reaches the app's **other open tabs** (feature names over a `BroadcastChannel`, never data), so they refresh too. Data from **other devices** is picked up when the user returns to the tab. `invalidate()` (`app/utils/invalidate.ts`) refetches every loaded key with those prefixes, so a feature never imports another feature's keys. Calls within 30ms are merged into one refresh per list (batches, parallel deletes). Example: category mutations invalidate `['categories', 'products']` because product lists show category names.

## CRUD state: `useApiQuery` and `useMutation`

Every read goes through **`useApiQuery`** and every create/update/delete through **`useMutation`**. Never hand-roll `loading` refs, try/catch or toasts for API calls.

**Reads:** `useApiQuery(key, handler, useAsyncDataOptions)` is `useAsyncData` with `pending` (boolean), `loading` (first load, no data yet), `refreshing` (reloading while old data is shown) and `error` (already an `ApiError`).

**Writes:** mutations are defined once per feature, in `use<Feature>Mutations()`, with `useMutation(fn, options)`:

| Option | Meaning |
|---|---|
| `id` | `'<feature>:<action>'`. **State is shared by id app-wide** (`useState`): a row sees "saving" even after the modal that started it was closed |
| `key` | Identifies the item (`c => c.id`). Different keys run **in parallel**. A call for a key already in flight is **skipped** (no double submit). Omit only if calls must run one at a time |
| `confirm` | Ask first (deletes). The dialog closes on answer and the work continues in the background |
| `successMessage` / `errorMessage` | Toast titles; name the item (`Category "Tea" deleted`). The error description is the `ApiError` message |
| `invalidate` | Features to refresh after success |
| `removes` | The row disappears on success (`isRemoved(key)`) before the refreshed list arrives |
| `batch` | Enables `executeMany`: `noun`, `verb`, `concurrency` (default 4), `confirm(items)`, `phases(items)` (e.g. children before parents) |

The returned object is **reactive (don't destructure it)**:

- `execute(input, { confirm?, errorActions? })` **never throws**. It resolves to `{ ok: true, data }`, `{ ok: false, status: 'error', error }`, or `{ ok: false, status: 'cancelled' | 'skipped' }`.
- `executeMany(items)` runs with one confirmation, limited concurrency, a progress toast with **Stop**, one summary toast ("3 categories deleted, 1 failed", reasons grouped, **Retry failed**) and one refresh. It resolves to `{ succeeded, failed, skipped, notStarted, cancelled }`. Items already in flight are skipped, not sent twice.
- `isPending(key?)`, `pending`, `pendingCount()`, `errorOf(key?)`, `error`, `data`, `isRemoved(key)`, `reset(key?)`.
- Calls are **never cancelled on unmount**. `plugins/leave-guard.client.ts` warns before the tab closes while anything is in flight.

Rules the Categories reference follows:

- The feature exposes **`isBusy(id)`** (any mutation in flight for that item). The list dims the row, shows a spinner instead of its actions, and blocks new actions on it.
- **Form modals stay open while saving** (backend errors need the input on screen) but **can be closed**: the save continues. If it then fails, the toast offers **"Reopen"** with the draft restored (`errorActions` + a `draft` prop).
- **Unsaved changes are guarded.** Every create/edit form uses `useModalUnsavedChanges` (modals) or `useUnsavedChanges` (pages), so closing the modal, changing route, logging out or reloading with changed input asks first. Pass `paused: saving` and call `markClean()` after a successful save (see [docs/reference/forms.md](docs/reference/forms.md)).
- **Create is keyed by something that identifies the submission** (the name), so two different creates can run in parallel while a double submit is skipped.
- **Bulk actions:** `useTableSelection(rows, getKey, { resetOn: [query] })` + `<BulkActionsBar>`. Selection clears on filter or page change. After `executeMany`, keep only the `failed` and `notStarted` rows selected.
- If the current page becomes empty after deletes, step back to the last existing page.

The concurrency rules live in the framework-free engine `app/utils/mutation.ts` and are unit-tested in `test/unit/mutation.test.ts`. `useMutation` only wires it to Nuxt (state, toasts, confirm, invalidate).

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
| Create/update/delete | `useMutation` does it: toasts, per-item `errorOf(key)`, silent errors skipped |
| Other one-off API action (e.g. export) | `try { … notify.success('Exported') } catch (e) { notify.error('Could not export', e) }` with `useNotify()` |
| Failed load (`useApiQuery` error) | `<ApiErrorAlert v-if="error" :error="error" title="Could not load …" @retry="refresh()" />` |
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
- App-wide behavior needs nothing from features: login/logout apply to all open tabs (`plugins/auth-sync.client.ts`), `?` shows keyboard shortcuts, tab titles from `definePageMeta({ title })`, a save in one tab refreshes the same lists in the app's other tabs at once, lists refetch when the user returns to the tab (data ≥ 5s old) or the connection comes back (`plugins/data-freshness.client.ts`), offline banner (`OfflineBanner`), leave guards. Cases: [docs/reference/app-behavior.md](docs/reference/app-behavior.md).
- `ssr: false`: the app is a pure SPA because only the browser has the auth cookies. Don't add server routes or SSR-dependent code.
- `app/layouts/default.vue` is the Nuxt UI dashboard shell. The sidebar is `app/utils/navigation.ts`, which groups and orders each feature's exported `navigation` entry.
- Every page component renders a `UDashboardPanel`: `UDashboardNavbar` (title, `UDashboardSidebarCollapse`, actions in `#right`), an optional `UDashboardToolbar` with filters in `#left`, and content in `#body`.

## Shared building blocks (root, auto-imported)

Summary only. Full signatures, options and examples are in **[docs/reference/](docs/reference/README.md)**.

| What | Where | Use for |
|---|---|---|
| `useApiQuery(key, handler, opts)` | `composables/` | Every read (see "CRUD state") |
| `useMutation(fn, opts)` | `composables/`, engine in `utils/mutation.ts` | Every create/update/delete, single or batch |
| `useTableSelection`, `BulkActionsBar` | `composables/`, `components/` | Row checkboxes and bulk actions |
| `previewList`, `pluralize` | `utils/text.ts` | "Coffee, Tea and 3 more", "3 categories" |
| `usePaginatedQuery(filters)` | `composables/` | List state **kept in the URL**: 1-based `page` for `UPagination`, `query` with the 0-based API page, resets page on filter change, strips `ANY`/'', `isFiltered`, `clearFilters` |
| `ANY`, `toApiQuery` | `utils/query.ts` | "All" option in filter selects (`USelect` can't hold `undefined`) |
| `invalidate(...features)` | `utils/invalidate.ts` | Refetch data after mutations |
| `StatusBadge`, `STATUS_ITEMS`, `STATUS_FILTER_ITEMS`, `Status` | `components/`, `utils/status.ts` | ACTIVE/INACTIVE display, form select and filter select |
| `useConfirm()` | `composables/` | `await confirm({ title, danger: true })` resolves to `boolean` (`useMutation`'s `confirm` uses it) |
| `unwrap`, `ApiError`, `getErrorMessage` | `utils/api*.ts` | API calls and errors (see "Error handling") |
| `useUnsavedChanges`, `useModalUnsavedChanges`, `useLeaveGuard` | `composables/`, `utils/form-value.ts` | "Discard unsaved changes?" for page and modal forms; the route middleware and tab-close plugin use them |
| `<SearchInput>`, `<ListEmptyState>` | `components/` | List toolbar search (as you type) and empty states ("nothing yet" vs "filters hide everything") |
| `invalidateAll()`, `invalidateInThisTab()` | `utils/invalidate.ts` | Refetch loaded or only stale queries / invalidate without telling other tabs (used by the freshness plugin) |
| `usePageShortcuts`, `useSubmitShortcut`, `SHORTCUTS`, `<ShortcutsHelp>` | `composables/useShortcuts.ts`, `components/` | Keyboard shortcuts (skipped behind dialogs/menus), Ctrl/⌘+Enter to save, the `?` list |
| `useNotify()` | `composables/` | Toasts for API actions that aren't mutations |
| `ApiErrorAlert` | `components/` | Load-error alert with Retry |

Expected to be promoted to the root when the first two features need them: `ImageUpload` (products, rewards, banners and vouchers all have upload endpoints) and `I18nFields` (for `nameI18n` / `descriptionI18n`).

## Adding a feature (e.g. products)

First plan it with the template in **[docs/feature-standard.md](docs/feature-standard.md)** (`docs/plans/<feature>.md`), and finish against its definition of done. Then mirror `app/features/categories/` file by file:

1. **Endpoints:** find them in `app/generated/api/sdk.gen.ts` by URL. If they're missing or stale, run `pnpm api:generate`.
2. **`composables/use<Feature>s.ts` (private):**
   - `use<Feature>List(query)`: `useApiQuery('<feature>:list', () => unwrap(sdkFn({ query: toValue(query) })), { watch: [() => ({ ...toValue(query) })] })`.
   - `use<Feature>Mutations()`: `create` / `update` / `remove` built with `useMutation` (ids `'<feature>:<action>'`, `key`, messages naming the item, `invalidate`, `confirm` + `removes` + `batch` for remove), plus `isBusy(id)`.
3. **`composables/use<Feature>Options.ts` + `components/<Feature>Select.vue` (public):** add these if other features need to pick this resource. Key the options per filter. The select hides the `USelect` sentinel for "none" (see `CategorySelect`).
4. **`schemas/<feature>-form.ts`:** the Valibot schema with user-facing messages (generated request schemas carry no rules). `to<Feature>Form(existing?)` builds the initial form state. `to<Feature>Request(form, existing?)` builds the request body and **copies over fields the form doesn't edit** (`nameI18n`, `sortOrder`, ...) so the PUT doesn't wipe them. Unit-test it in `tests/`.
5. **`components/<Feature>FormModal.vue`:** opened with `useOverlay().create(...)`. On submit: `const result = await create.execute(body, { errorActions })`, then `if (result.ok) emit('close', true)`. It supports closing mid-save with "Reopen" (`draft` prop), saves on Ctrl/⌘+Enter (`useSubmitShortcut(() => form.value?.submit())`, hint via `UTooltip :kbds="['meta', 'enter']"` on the submit button), guards unsaved input with `useModalUnsavedChanges` (declare the `update:open` emit, bind `@update:open` on `UModal`, Cancel calls `requestClose()`), and pulls in other features' pickers from their `index.ts`.
6. **`components/<Feature>ListPage.vue`:** `usePaginatedQuery` (filters and page live in the URL) + list composable. Toolbar: `<SearchInput v-model="filters.search">` (searches as you type, `/` focuses it). `usePageShortcuts({ n: () => openForm() })` with `UTooltip :kbds="['n']"` on the New button and filter `USelect`s. `UTable` fills `#loading` and `#empty` (`<ListEmptyState :filtered="isFiltered" @create @clear="clearFilters()">`). Rows exclude `remove.isRemoved(id)`. `UTable` with a select column (`useTableSelection`), `#<column>-cell` slots, busy rows (`isBusy`: dimmed, spinner instead of actions), `<ApiErrorAlert>` on load error, row actions through `UDropdownMenu` (delete = `remove.execute(row)`), and `<BulkActionsBar>` calling `remove.executeMany(selection.selected)`.
7. **`navigation.ts` + `index.ts`:** export the sidebar entry and the public building blocks, then add the entry to a group in `app/utils/navigation.ts`.
8. **Route file** `app/pages/<feature>/index.vue`: `definePageMeta({ title: '<Feature>' })`, then import and render `<Feature>ListPage.vue`, nothing else.
9. **E2E test** `test/e2e/<feature>.test.ts`: at least list + create + delete, with `mockApi` (see "Tests").

## Tests

`vitest.config.ts` defines three projects:
- **unit** (Node, no Nuxt runtime): `app/features/*/tests/**/*.test.ts` and `test/unit/**`. Test pure code such as schemas, form mapping and utils. Files under test must import their dependencies explicitly, not through auto-imports.
- **nuxt** (Nuxt environment via `@nuxt/test-utils`): `app/features/*/tests/**/*.nuxt.test.ts` and `test/nuxt/**`.
- **e2e**: `test/e2e/**` (`@nuxt/test-utils/e2e` + `playwright-core`, real Chrome). `test/e2e/support/global-setup.ts` builds and serves the app **once** for all files. Start each file with `await setupE2e()`, and mock the backend with `mockApi(page, { 'GET /staff/x': () => data })` from `test/e2e/support/mock-api.ts` (throw `MockFailure` for `success: false`). Helpers: `gotoViaSidebar` (needed before testing back/forward), `beforeUnloadPrevented`, `toast`, `pageOf`. Pitfalls: docs/progress.md → "How to verify". `pnpm vitest run --project e2e` takes about a minute (mostly the build).

Shared code tests live in `test/` (e.g. `test/unit/api-fetch.test.ts` covers the envelope, refresh and retry logic).

## Conventions

- Prefer Nuxt-native tools (`useAsyncData`, `useState`, `useRuntimeConfig`, route middleware), then `@vueuse/core` (import it explicitly: it isn't auto-imported), before adding a library or hand-rolling a utility. There is no Pinia: shared state is `useState` inside a composable.
- Import SDK functions and types from `~/generated/api`, and Valibot as `import * as v from 'valibot'`.
- Icons are bundled at build time, never fetched (decisions D18). Write icon names as literal strings (`'i-lucide-tags'`), not template strings, and install `@iconify-json/<collection>` before using a new collection.
- `USelect` cannot hold an empty or `undefined` value. Use `ANY` for "all" filters and let the `<Feature>Select` components handle "none".
- The UI chrome is English only. Translatable content fields (`nameI18n`, ...) are data, preserved on update.
