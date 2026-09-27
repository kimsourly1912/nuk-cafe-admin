# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, and others) working in this repository. This is the **single source of truth**. `CLAUDE.md` only imports this file.

## Resuming work: read first

1. **[docs/progress.md](docs/progress.md)**: what's done, what's next, open questions for the backend team, and how well each part has been verified. Start every session here.
2. **[docs/decisions.md](docs/decisions.md)**: why things are the way they are. Read the relevant entry **before changing** a pattern that looks odd. Most of them work around a verified backend or tooling quirk.
3. **[docs/reference/](docs/reference/README.md)**: reference for every shared app composable, util and component (`useMutation`, `useApiQuery`, `apiFetch`, `ApiError`, …) with types, options and examples. Its [api.md](docs/reference/api.md) documents the pre-standard `/api/v1` routes still in use until step 3.8b; new server work follows docs/server/. Check it before using or changing a shared API. **[App-wide behavior](docs/reference/app-behavior.md)** (tab titles, refresh on tab focus, offline, leave guards, session loss) and **[Forms: unsaved changes](docs/reference/forms.md)** list every edge case those handle.
4. **[docs/feature-standard.md](docs/feature-standard.md)**: how every new feature is planned, built and verified (planning template, list/form/picker behavior, definition of done). **Read it before starting a feature.**
5. **[docs/server/](docs/server/README.md)**: the **server standard** (architecture, security, data model, operations). **Every server change follows it.** The only server code that doesn't follow it yet is the legacy menu (`/api/v1`, `server/legacy/menu`, the D41 tables), replaced in step 3.8b (D43).
6. The rest of this file: rules and recipes.

**Keep these documents current as part of your work:**
- Finished or started something → update `docs/progress.md` (status, next steps, and what you verified and how).
- Made or changed an architectural decision → add or amend an entry in `docs/decisions.md`.
- Changed a convention, rule or shared building block → update this file.
- Added or changed a shared API (or a feature's public `index.ts`) → update its page in `docs/reference/` (examples must compile).
- Found or handled an **edge case** (a browser quirk, a backend inconsistency, a timing issue) → add it to the case table of the page it belongs to (`app-behavior.md`, `forms.md`, `data-fetching.md`, …) with how it's handled and which test covers it. Test pitfalls go in `docs/progress.md` → "How to verify".

## What this is

NUK Cafe is one Nuxt full stack app: the customer website, the admin workspace and the cashier workspace, plus our own API (Nitro) with Better Auth, NuxtHub, Drizzle, SQLite locally and D1/R2/KV on Cloudflare. Product scope: [the system blueprint](docs/plans/system-blueprint.md). **How the server is built: the [server standard](docs/server/README.md)** (routes `/api/<surface>/…`, `server/features/` with service/repository layers, Better Auth roles and branches, the data model, operations). Build order: [progress.md → Next steps](docs/progress.md#next-steps-recommended-order).

**Transition:** the menu screens (categories, schedules, menu items) still run on the pre-standard `/api/v1` routes (D41), now checked with `requirePermission`. Their server code lives in `server/legacy/` and is replaced in step 3.8b; don't extend it (ESLint forbids new code from importing it). Sign-in, staff and the **Availability** and **Options** pages (`app/features/availability-rules/`, `app/features/option-sets/`, the new API's first menu screens, D66, D67) run on the standard's `/api/admin` routes (D52).

The code is **organized by feature** under `app/features/`. `app/features/categories/` is the **reference feature** for composables, mutations and forms: copy its patterns for every new feature (see "Adding a feature"). For **paginated list pages**, copy Schedules (card list) or Menu items (card grid + table); Categories is a tree (D37).

## Commands

Package manager is **pnpm**.

```bash
pnpm dev                                  # http://localhost:3000; /api is local Nitro/Better Auth
pnpm nuxt db generate                     # create a migration after changing the server schema
pnpm nuxt db migrate                      # apply local SQLite migrations
pnpm lint / pnpm lint:fix                 # ESLint also does formatting (no Prettier) and enforces feature boundaries
pnpm typecheck                            # vue-tsc via nuxt typecheck
pnpm test                                 # all Vitest projects
pnpm test:unit / pnpm test:e2e            # unit + server (seconds) / e2e only (about two minutes, builds the app)
pnpm vitest run --project server          # one project: unit | server | e2e (| nuxt, once a *.nuxt.test.ts exists)
pnpm vitest run app/features/categories   # one feature's tests
pnpm vitest run -t "refreshes once"
```

Before finishing a change, run `pnpm lint`, `pnpm typecheck` and `pnpm test`. CI (`.github/workflows/ci.yml`) runs the same commands. Local setup for a first admin: [docs/reference/auth.md → First admin](docs/reference/auth.md#first-admin-local-setup).

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
server/                          # our API, per docs/server/architecture.md (pre-standard code still in api/v1 and db/schema)
shared/contracts/                # API contracts: request schemas + response types, used by server and app
```

### Rules (the boundary rules are enforced by ESLint in `eslint.config.mjs`)

1. **Everything specific to one feature lives in `app/features/<feature>/`.** Only code used by two or more features, or by the app shell, goes in the root `components/`, `composables/` or `utils/`. Build it inside the feature first, and move it to the root when a second feature needs it.
2. **`index.ts` exports only building blocks:** pickers (`CategorySelect`), display components, option composables (`useCategoryOptions`), types and `navigation`. **Never export pages or forms from `index.ts`.** Otherwise features that use each other (products ↔ schedules) would import each other's screens and create cycles.
3. **Cross-feature imports go through the public API only:** `import { CategorySelect } from '~/features/categories'`. Deep imports (`~/features/x/composables/...`) and relative paths that leave the feature (`../../x`) are lint errors.
4. **Public building blocks must not import other features.** This keeps the dependency graph one level deep, so no cycles can form. Screens (pages, forms) may import other features' public APIs.
5. **Inside a feature, use relative imports** (`../composables/useCategories`). Feature code is *not* auto-imported. Root shared code *is* auto-imported everywhere (`apiFetch`, `getErrorMessage`, `invalidate`, `usePaginatedQuery`, `useConfirm`, `StatusBadge`, `STATUS_ITEMS`, `ANY`, ...).
6. **Route files in `app/pages/` stay thin.** They hold `definePageMeta` (always with a `title` for the browser tab) plus one `<Feature>…Page.vue` from the feature (the only deep import pages are allowed). Routes stay discoverable in one place.
7. **Name feature folders after the resource they manage**, so a folder maps to its routes (`/api/admin/<resource>`) and contracts: `categories`, `products` (shown as "Menu items" in the UI), `schedules`, `availability-rules` (shown as "Availability"), `option-sets` (shown as "Options"), `rewards` (reward categories live inside it: they're not menu categories), `vouchers`, `banners`, `customers`, `staff`, `orders`, `auth`.

### Cross-feature relationships (from the API)

- A menu item (`Product`) has `categoryId` (required) and `scheduleIds[]`, so the products form uses `CategorySelect` and `ScheduleSelect`. Pickers forward attributes (`aria-label`) to their select and take `class` on the wrapper (D34).
- The item ↔ schedule link is stored once (`product_schedules`) and written **only from the menu item** (`scheduleIds`). The schedule form shows its menu items read-only (`GET /schedules/{id}` → `products`) and never sends them (D41).
- A category has an optional `parentId` (main vs sub, two levels). The category form uses its own `CategorySelect level="main"`.
- Every update names the `version` it read; a stale one is refused with 409 (D41). Forms keep the record they opened and send its version.

### Data freshness

- Query keys are **namespaced by feature**: `<feature>:<name>` (`categories:list`, `categories:options:MAIN:all`). `useApiQuery` warns in dev when a key isn't namespaced.
- Mutations declare `invalidate: ['<own feature>', '<affected feature>']`. The same invalidation reaches the app's **other open tabs** (feature names over a `BroadcastChannel`, never data), so they refresh too. Data from **other devices** is picked up when the user returns to the tab. `invalidate()` (`app/utils/invalidate.ts`) refetches every loaded key with those prefixes, so a feature never imports another feature's keys. Calls within 30ms are merged into one refresh per list (batches, parallel deletes). Example: category mutations invalidate `['categories', 'products']` because product lists show category names.

## CRUD state: `useApiQuery` and `useMutation`

Every read goes through **`useApiQuery`** and every create/update/delete through **`useMutation`**. Never duplicate their request state: no hand-rolled request `loading` refs, in-flight tracking, try/catch or toasts for API calls. A form may keep **its own** submission state (e.g. `saving` in `CategoryFormModal`, for its disabled inputs and unsaved-change pause). See [feature-standard.md §5](docs/feature-standard.md#form-local-vs-shared-pending-state).

**Reads:** `useApiQuery(key, handler, useAsyncDataOptions)` is `useAsyncData` with `pending` (boolean), `loading` (first load, no data yet), `refreshing` (reloading while old data is shown) and `error` (already an `ApiError`). Its `watch` option **cancels** a running request instead of queueing behind it (D30), so a slow older response never replaces newer results.

**Writes:** mutations are defined once per feature, in `use<Feature>Mutations()`, with `useMutation(fn, options)`:

| Option | Meaning |
|---|---|
| `id` | `'<feature>:<action>'`. **State is shared by id app-wide** (`useState`): a row sees "saving" even after the modal that started it was closed |
| `key` | Identifies the item (`c => c.id`). Different keys run **in parallel**. A call for a key already in flight is **skipped** (no double submit). Omit only if calls must run one at a time |
| `lock` | Record lock shared **across mutations** (e.g. `category:7` from both update and remove). Give every mutation that can conflict on a record (update, remove, status…) the same lock: a call whose lock is held is skipped when it would start (after confirmation, per batch item) with an explaining toast. **Required** for conflicting operations (D28) |
| `confirm` | Ask first (deletes). The dialog closes on answer and the work continues in the background |
| `successMessage` / `errorMessage` | Toast titles; name the item (`Category "Tea" deleted`). The error description is the `ApiError` message |
| `invalidate` | Features to refresh after success |
| `removes` | The row disappears on success (`isRemoved(key)`) before the refreshed list arrives |
| `batch` | Enables `executeMany`: `noun`, `verb`, `concurrency` (default 4), `confirm(items)`, `phases(items)` (e.g. children before parents) |

The returned object is **reactive (don't destructure it)**:

- `execute(input, { confirm?, errorActions? })` **never throws**. It resolves to `{ ok: true, data }`, `{ ok: false, status: 'error', error }`, or `{ ok: false, status: 'cancelled' | 'skipped' }`.
- `executeMany(items)` runs with one confirmation, limited concurrency, a progress toast with **Stop**, one summary toast ("3 categories deleted, 1 failed", reasons grouped, **Retry failed**) and one refresh. It resolves to `{ succeeded, failed, skipped, notStarted, cancelled }`. Busy items (same mutation in flight, or their `lock` held by another mutation, e.g. a pending update during a bulk delete) are skipped, checked again when each item starts, and reported in the summary.
- `isPending(key?)`, `pending`, `pendingCount()`, `errorOf(key?)`, `error`, `data`, `isRemoved(key)`, `reset(key?)`.
- Calls are **never cancelled on unmount**. `plugins/leave-guard.client.ts` warns before the tab closes while anything is in flight.

Rules the Categories reference follows:

- The feature exposes **`isBusy(id)`** (any mutation in flight for that item). The list dims the row and shows a spinner instead of its row actions. That is the display; the exclusion itself is `lock` ([mutations.md](docs/reference/mutations.md#concurrency-guarantee-and-current-limits)). After a bulk action, keep `failed`, `skipped` and `notStarted` rows selected.
- **Form modals stay open while saving** (backend errors need the input on screen) but **can be closed**: the save continues. If it then fails, the toast offers **"Reopen"** with the draft restored (`errorActions` + a `draft` prop).
- **Unsaved changes are guarded.** Every create/edit form uses `useModalUnsavedChanges` (modals) or `useUnsavedChanges` (pages), so closing the modal, changing route, logging out or reloading with changed input asks first. Pass `paused: saving` and call `markClean()` after a successful save (see [docs/reference/forms.md](docs/reference/forms.md)).
- **Create is keyed by something that identifies the submission** (the name), so two different creates can run in parallel while a double submit is skipped.
- **Bulk actions:** `useTableSelection(rows, getKey, { resetOn: [query] })` + `<BulkActionsBar>`. Selection clears on filter or page change. After `executeMany`, keep only the `failed` and `notStarted` rows selected.
- If the current page becomes empty after deletes, step back to the last existing page.

The concurrency rules live in the framework-free engine `app/utils/mutation.ts` and are unit-tested in `test/unit/mutation.test.ts`. `useMutation` only wires it to Nuxt (state, toasts, confirm, invalidate).

## Server

Every server change follows the [server standard](docs/server/README.md). The essentials:

- **Library first:** Better Auth (`admin` + `organization` plugins, access control), `@nuxtjs/better-auth`, NuxtHub and Cloudflare features before our own code ([security.md → What the libraries do](docs/server/security.md#what-the-libraries-do)).
- **Routes** are thin, unversioned, per surface: `/api/public`, `/api/shop`, `/api/counter/{branchId}`, `/api/admin`.
- **Features** live in `server/features/<feature>/` with fixed layers: `index.ts` (public API), `*.schema.ts`, `*.types.ts`, `*.repository.ts` (all SQL), `*.service.ts` (rules and use cases), `*.errors.ts`, `tests/`.
- **Writes:** `version` checks, one atomic `db.batch` with guards, idempotency keys for money/points/vouchers, audit in the same batch.
- **The app calls the API only through `apiFetch`**, inside `useApiQuery` / `useMutation` (`ApiError`, session handling, stale-response discard).
- Do not restore the Spring SDK, proxy or envelope handling (D39).

## Auth & app shell

- `app/features/auth/` exposes `useAuth()`: sign-in, sign-out and password change through Better Auth (`/api/auth`), the admin session from `GET /api/admin/me`. Only platform **admins** use the admin app (D52); a customer or branch-staff account is refused at login. On a temporary password every page goes to `/change-password` first. Its state keys are `staff-session:*`: `auth:*` belongs to `@nuxtjs/better-auth`. The shell imports it from `~/features/auth`. Staff are managed on the **Staff** page (`app/features/staff/`).
- The middleware protects **every page by default**. Opt out with `definePageMeta({ public: true })` (typed in `app/types/page-meta.d.ts`).
- **Session transitions** (login, logout, expiry, another staff member via another tab) clear the previous identity's query data, mutation outcomes, toasts, overlays and unsaved forms, and discard its in-flight responses (`plugins/session-boundary.client.ts`, `useAuth().generation`, D29). Features must not keep user data outside `useApiQuery`/`useMutation`/`useState`-based composables, or the boundary can't clear it.
- App-wide behavior needs nothing from features: login/logout apply to all open tabs (`plugins/auth-sync.client.ts`), `?` shows keyboard shortcuts, tab titles from `definePageMeta({ title })`, a save in one tab refreshes the same lists in the app's other tabs at once, lists refetch when the user returns to the tab (data ≥ 5s old) or the connection comes back (`plugins/data-freshness.client.ts`), offline banner (`OfflineBanner`), leave guards. Cases: [docs/reference/app-behavior.md](docs/reference/app-behavior.md).
- `ssr: false` keeps the **admin UI** a SPA; Nitro serves `/api/v1` and Better Auth `/api/auth` from the same origin. Decide customer-site SSR separately.
- `app/layouts/default.vue` is the Nuxt UI dashboard shell. The sidebar is `app/utils/navigation.ts`, which groups and orders each feature's exported `navigation` entry.
- Every page component renders a `UDashboardPanel`: `UDashboardNavbar` (title, `UDashboardSidebarCollapse`, actions in `#right`), an optional `UDashboardToolbar` with filters in `#left`, and content in `#body`.

## Shared building blocks (root, auto-imported)

Summary only. Full signatures, options and examples are in **[docs/reference/](docs/reference/README.md)**.

| What | Where | Use for |
|---|---|---|
| `apiFetch<T>(path, opts)` | `utils/api.ts`, engine `utils/api-fetch.ts` | Every call to our API (`/api` + path; legacy menu routes are `/v1/admin/…`): `ApiError` on failure, no retries, session loss and required password change handled |
| `useApiQuery(key, handler, opts)` | `composables/` | Every read (see "CRUD state") |
| `useMutation(fn, opts)` | `composables/`, engine in `utils/mutation.ts` | Every create/update/delete, single or batch |
| `useTableSelection`, `BulkActionsBar` | `composables/`, `components/` | Selection for tables, cards and trees (`isSelected`, `toggle`, `toggleAll`); the floating bulk bar |
| `StatusTabs`, `useStatusCounts` | `components/`, `composables/` | Status filter as tabs with counts |
| `ListSkeleton` | `components/` | First-load placeholders (rows or cards) |
| `previewList`, `pluralize` | `utils/text.ts` | "Coffee, Tea and 3 more", "3 categories" |
| `usePaginatedQuery(filters)` | `composables/` | List state **kept in the URL**: 1-based `page` (UI and API), `query` with `page` + `pageSize`, resets page on filter change, strips `ANY`/'', `isFiltered`, `clearFilters` |
| `ANY`, `toApiQuery` | `utils/query.ts` | "All" option in filter selects (`USelect` can't hold `undefined`) |
| `invalidate(...features)` | `utils/invalidate.ts` | Refetch data after mutations |
| `StatusBadge`, `STATUS_ITEMS`, `STATUS_FILTER_ITEMS`, `Status` | `components/`, `utils/status.ts` | ACTIVE/INACTIVE display, form select and filter select |
| `useConfirm()` | `composables/` | `await confirm({ title, danger: true })` resolves to `boolean` (`useMutation`'s `confirm` uses it) |
| `ApiError`, `getErrorMessage` | `utils/api-error.ts` | One error type for every failure (our API's and Better Auth's formats); `kind`, `code`, `fieldErrors`, a user-safe `message` |
| `useUnsavedChanges`, `useModalUnsavedChanges`, `useLeaveGuard` | `composables/`, `utils/form-value.ts` | "Discard unsaved changes?" for page and modal forms; the route middleware and tab-close plugin use them |
| `<SearchInput>`, `<ListEmptyState>` | `components/` | List toolbar search (as you type) and empty states ("nothing yet" vs "filters hide everything") |
| `invalidateAll()`, `invalidateInThisTab()` | `utils/invalidate.ts` | Refetch loaded or only stale queries / invalidate without telling other tabs (used by the freshness plugin) |
| `usePageShortcuts`, `useSubmitShortcut`, `SHORTCUTS`, `<ShortcutsHelp>` | `composables/useShortcuts.ts`, `components/` | Keyboard shortcuts (skipped behind dialogs/menus), Ctrl/⌘+Enter to save, the `?` list |
| `useNotify()` | `composables/` | Toasts for API actions that aren't mutations |
| `ApiErrorAlert` | `components/` | Load-error alert with Retry |

Expected to be promoted to the root when the first two features need them: `ProductImageInput` (in `app/features/products/`; rewards, banners and vouchers will need uploads too, through `POST /api/v1/admin/media`). Money (`toMinor`/`fromMinor` cents ↔ dollars, `formatPrice`, `formatMinor`, USD) lives in `app/features/products/utils/money.ts` until a second feature shows prices.

## Adding a full stack feature

1. Start from the user journeys in [the system blueprint](docs/plans/system-blueprint.md) and write a plan with [docs/feature-standard.md](docs/feature-standard.md). Settle any unresolved business or permission rule first, or defer that behavior; never encode a guess.
2. The server side per the [server standard](docs/server/README.md): contracts in `shared/contracts/<domain>.ts`; the feature in `server/features/<feature>/` (schema + migration, repository, service, errors, types); thin routes under the right surface; permissions in the identity feature.
3. Server tests in the feature's `tests/` against SQLite built from the migrations: rules, each error code, permission cases, and a stale-version / race / replay case for every guarded or idempotent write (check that it fails with the guard removed).
4. The feature folder in `app/features/<feature>/` (copy Categories for composables/forms, Schedules or Menu items for paginated lists), calling `apiFetch` through `useApiQuery` / `useMutation`.
5. Browser tests in `test/e2e/<feature>.test.ts` with `mockApi` and the typed fixtures in `test/e2e/support/mock-api.ts`.
6. Update the server standard where it changed, the feature's reference page, progress.md and decisions.md.

## Tests

`vitest.config.ts` projects:
- **unit** (`test/unit`, `app/features/*/tests`): pure logic in Node: engines, form schemas and mappings.
- **server** (`test/server` today; `server/features/*/tests` per the standard): services against an in-memory SQLite database built from the checked-in migrations, foreign keys on (D42).
- **e2e** (`test/e2e`): builds the app once and drives Chrome with the API mocked in the browser (`mockApi`).
- **nuxt**: only created once a `*.nuxt.test.ts` exists (D42).

## Conventions

- Prefer Nuxt-native tools (`useAsyncData`, `useState`, `useRuntimeConfig`, route middleware), then `@vueuse/core` (import it explicitly: it isn't auto-imported), before adding a library or hand-rolling a utility. There is no Pinia: shared state is `useState` inside a composable.
- Define new API contracts in project-owned code. Import Valibot as `import * as v from 'valibot'`.
- Icons are bundled at build time, never fetched (decisions D18). Write icon names as literal strings (`'i-lucide-tags'`), not template strings, and install `@iconify-json/<collection>` before using a new collection.
- `USelect` cannot hold an empty or `undefined` value. Use `ANY` for "all" filters and let the `<Feature>Select` components handle "none".
- The UI chrome is English only. Translatable content fields (`nameI18n`, ...) are data, preserved on update.
