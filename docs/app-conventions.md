# App conventions

> **Purpose:** the task-specific rules for writing app (Vue/Nuxt) code in a feature, moved verbatim from AGENTS.md: paths and screens, the reference features, feature rules 5 to 7, cross-feature relationships, data freshness, CRUD state (`useApiQuery`, `useMutation`), the auth and app-shell details, and conventions. The invariants (tenant scoping, concurrency, where code goes, sessions) stay in AGENTS.md. Read it when writing or changing app code.

Sections: [Paths and screens](#what-this-is-continued-paths-screens-reference-features) · [Rules 5 to 7](#feature-architecture-rules-5-to-7) · [Cross-feature relationships](#cross-feature-relationships-from-the-api) · [Data freshness](#data-freshness) · [CRUD state](#crud-state-useapiquery-and-usemutation) · [Auth and app shell](#auth--app-shell) · [Conventions](#conventions)

## What this is (continued): paths, screens, reference features

**Paths (D93, D141):** a cafe's pages live under its address, `/c/<slug>/…` (`app/pages/c/[slug]/`); **paths below are inside the cafe** (`/admin/products` means `/c/<slug>/admin/products`). Links go through `useTenantPath()` (`tenantPath('/admin/products')`); a lint rule refuses a bare cafe page in a link; the old addresses (`/`, `/admin/…`, …) redirect to NUK Cafe's. The platform's pages have no cafe: the account pages, Your cafes (`/cafes`, D144), `/table/<token>` and the platform console (`/platform/**`, super admins only, its own sign-in and session `usePlatformSession`, D142). Moving to another cafe is a full page load. The admin workspace lives under `/admin` (`/admin/login`, `/admin/products`, …); every other path is the **customer site**: `/` is the ordering-first menu (`app/features/menu/`, layout `shop`, on `/api/public`), `/table/<token>` a table's QR code, `/checkout` (Review order, D100) and `/orders/<id>` (the order, tracked) and `/orders` (Your orders; `app/features/orders/`, D114), and the customer's account pages (`/sign-in`, `/sign-up`, `/verify-email`, `/email-verified`, `/forgot-password`, `/reset-password`; `app/features/account/`, layout `account`, D97). The **counter workspace** (D102) lives under `/counter` (`/counter/sign-in`, `/counter/change-password`, `/counter` to choose a branch, `/counter/<branchId>` the queue; `app/features/counter/`, layout `counter`), for branch staff, managers and admins.

Every admin screen runs on the standard's `/api/admin` routes (D52): sign-in, **Cafe profile** (the cafe's name and logo, `app/features/cafe/`, D143), Staff, **Sample data** (test data from the UI, local and staging only, `app/features/sample-data/`, D94), **Branch** (settings, hours and dining tables with QR codes, `app/features/branches/`, D91), **Payments** (the riel rate, `app/features/exchange-rates/`, D102), **Telegram** (connected chats, `app/features/notifications/`, D112), **Reports** (`app/features/reports/`, D110, D111), **Promotions** (Marketing: discounts on the menu with an uploaded poster, `app/features/promotions/`, D163, posted to the cafe's channels from a promotion's page, D164), **Channels** (Marketing: the cafe's Telegram channel, `app/features/marketing/`, D164), and the menu's **Menu items**, **Categories**, **Options**, **Add-ons** and **Availability** pages (`app/features/products/`, `categories/`, `option-sets/`, `modifier-groups/`, `availability-rules/`, D66–D70). The pre-standard `/api/v1` menu and its tables were removed in step 3.8b (D71).

The code is **organized by feature** under `app/features/`. `app/features/categories/` is the **reference feature** for composables, mutations and forms: copy its patterns for every new feature (see "Adding a feature"). For **paginated list pages**, copy Menu items (card grid + table); for a small library loaded whole, Options or Add-ons (cards, filtered on the client); Categories is a tree (D37). For a **record with its own page** (a route such as `/add-ons/[id]`: breadcrumb, a main column and a settings column, tabs on phones), copy the Add-on group page (D75).

## Feature architecture: rules 5 to 7

_Rules 1 to 4 (the boundary rules enforced by ESLint) are in AGENTS.md._

5. **Inside an app feature, use relative imports** (`../composables/useCategories`). Feature code is *not* auto-imported. Root shared code *is* auto-imported everywhere (`apiFetch`, `getErrorMessage`, `invalidate`, `usePaginatedQuery`, `useConfirm`, `StatusTabs`, `ANY`, `formatMinor`, ...).
6. **Route files in `app/pages/` stay thin.** They hold `definePageMeta` (always with a `title` for the browser tab) plus one `<Feature>…Page.vue` from the feature (the only deep import pages are allowed). Routes stay discoverable in one place.
7. **Name feature folders after the resource they manage**, so a folder maps to its routes (`/api/admin/<resource>`) and contracts: `categories`, `products` (shown as "Menu items" in the UI), `availability-rules` (shown as "Availability"), `option-sets` (shown as "Options"), `modifier-groups` (shown as "Add-ons"), `menu` (the customer menu, `/api/public/menu`), `account` (the customer's own account: its pages and the header's account button, on Better Auth and `/api/shop/me`, D97), `orders` (the customer's orders: the order page with tracking, Your orders and the menu's order bar, `/api/shop/orders`, D100, D114), `counter` (the cashier's workspace: its session, queue and commands on `/api/counter/{branchId}`, D102), `exchange-rates` (shown as "Payments", D102), `reports` (the admin's Summary, Sales by item and Order history, with CSV and Print, on `/api/admin/reports`, D110, D111), `notifications` (shown as "Telegram": connected chats and sending there, on `/api/admin/telegram`, D112), `sample-data` (test data, D94), `platform` (the platform console for super admins: Cafes, New cafe, a cafe's page, on `/api/platform/tenants`, D142; server feature `tenants`), `assistant` (the AI help assistant's panel, on `/api/admin/assistant`, D107, D109; its help guide is `server/features/assistant/help/*.md`: **a change to an admin screen updates its page there**), `cafe` (shown as "Cafe profile": the cafe's name and logo, on `/api/admin/cafe`, D143; Your cafes `/cafes` and the `<CafeSwitcher>`, on `/api/me/cafes`, D144), `dashboard` (the admin's home: today and "Set up your cafe", D155), `promotions` (Marketing → Promotions: discounts on the menu, on `/api/admin/menu/promotions`, D163; server code in the menu feature, since promotions change menu prices; its posts to channels, D164), `marketing` (Marketing → Channels: the cafe's social channels, on `/api/admin/marketing`, D164; posts are made from a promotion's page), `rewards` (reward categories live inside it: they're not menu categories), `vouchers`, `banners`, `customers`, `staff`, `auth`.

## Cross-feature relationships (from the API)

_The bullets on writing an item's library links and on `version` are in AGENTS.md._

- A menu item has a leaf `categoryId` (required, D44), option sets with a price grid, add-on groups and availability rules, so the item form uses `CategorySelect level="leaf"`, `useOptionSetOptions`, `useModifierGroupOptions` and `AvailabilityRuleSelect` (D70). Pickers forward attributes (`aria-label`) to their select and take `class` on the wrapper (D34).
- A category has an optional `parentId` (main vs sub, two levels). The category form uses its own `CategorySelect level="main"`.

### Data freshness

- Query keys are **namespaced by feature**: `<feature>:<name>` (`categories:all`, `availability-rules:options`). `useApiQuery` warns in dev when a key isn't namespaced.
- Mutations declare `invalidate: ['<own feature>', '<affected feature>']`. The same invalidation reaches the app's **other open tabs** (feature names over a `BroadcastChannel`, never data), so they refresh too. Data from **other devices** is picked up when the user returns to the tab. `invalidate()` (`app/utils/invalidate.ts`) refetches every loaded key with those prefixes, so a feature never imports another feature's keys. Calls within 30ms are merged into one refresh per list (batches, parallel deletes). Example: category mutations invalidate `['categories', 'products']` because product lists show category names.

## CRUD state: `useApiQuery` and `useMutation`

_The first paragraph ("Every read goes through `useApiQuery`…") is in AGENTS.md._

**Reads:** `useApiQuery(key, handler, useAsyncDataOptions)` is `useAsyncData` with `pending` (boolean), `loading` (first load, no data yet), `refreshing` (reloading while old data is shown) and `error` (already an `ApiError`). Its `watch` option **cancels** a running request instead of queueing behind it (D30), so a slow older response never replaces newer results. **A refresh that fails for the connection or the server keeps the last data** (`error` still set; never across keys or sessions, D150): show it with a note where it matters.

**Writes:** mutations are defined once per feature, in `use<Feature>Mutations()`, with `useMutation(fn, options)`:

| Option | Meaning |
|---|---|
| `id` | `'<feature>:<action>'`. **State is shared by id app-wide** (`useState`): a row sees "saving" even after the modal that started it was closed |
| `key` | Identifies the item (`c => c.id`). Different keys run **in parallel**. A call for a key already in flight is **skipped** (no double submit). Omit only if calls must run one at a time |
| `lock` | Record lock shared **across mutations** (e.g. `category:7` from both update and remove). Give every mutation that can conflict on a record (update, remove, status…) the same lock: a call whose lock is held is skipped when it would start (after confirmation, per batch item) with an explaining toast. **Required** for conflicting operations (D28) |
| `confirm` | Ask first (deletes). The dialog closes on answer and the work continues in the background |
| `undo` | Instead of asking: run at once and offer **Undo** on the toast (D152). Only where the reverse puts everything back the same (archive, unpublish); `execute(input, { undo: false, confirm })` inside a modal or slide-over, whose toast can't be reached |
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

- The feature exposes **`isBusy(id)`** (any mutation in flight for that item). The list dims the row and shows a spinner instead of its row actions. That is the display; the exclusion itself is `lock` ([mutations.md](reference/mutations.md#concurrency-guarantee-and-current-limits)). After a bulk action, keep `failed`, `skipped` and `notStarted` rows selected.
- **Form modals stay open while saving** (backend errors need the input on screen) but **can be closed**: the save continues. If it then fails, the toast offers **"Reopen"** with the draft restored (`errorActions` + a `draft` prop).
- **Unsaved changes are guarded.** Every create/edit form uses `useModalUnsavedChanges` (modals) or `useUnsavedChanges` (pages), so closing the modal, changing route, logging out or reloading with changed input asks first. Pass `paused: saving` and call `markClean()` after a successful save (see [docs/reference/forms.md](reference/forms.md)). A **long** form (minutes of input) also passes `draft` and shows `<FormDraftAlert>`, and calls `markSaved()` instead (D151); never for secrets.
- **Errors leave as soon as they're fixed:** every `UForm` calls `useFormErrorRecheck(form)` (D166). A checkbox or switch inside a group's `UFormField` gets its own `UFormField`. A control that saves when changed never blocks the others ([ui.md §17](reference/ui.md#17-expected-behavior-owner-2026-10-13-d165-d166)).
- **Create is keyed by something that identifies the submission** (the name), so two different creates can run in parallel while a double submit is skipped.
- **Bulk actions:** a **Select mode** (a toolbar toggle: Select, then Cancel in the same place; `S` toggles, Escape leaves; no always-on checkboxes; on phones behind the toolbar's `⋯`, D129) with `useTableSelection(rows, getKey, { resetOn: [query] })` + `<BulkActionsBar>` (D89). Selection clears on filter or page change. After `executeMany`, keep only the `failed`, `skipped` and `notStarted` rows selected.
- If the current page becomes empty after deletes, step back to the last existing page.

The concurrency rules live in the framework-free engine `app/utils/mutation.ts` and are unit-tested in `test/unit/mutation.test.ts`. `useMutation` only wires it to Nuxt (state, toasts, confirm, invalidate).

## Auth & app shell

_The bullets on who may use the admin, on the middleware protecting `/admin/**` and on session transitions are in AGENTS.md._

- **The counter workspace** (`app/features/counter/`, D102) has its own session, `useCounterSession()`: Better Auth's sign-in, then `GET /api/counter/me` (the branches the person works at; every active branch for an owner; 403 `NOT_STAFF` for a customer). Its state keys are `counter-session:*`; its identity changes fire `app:session-changed` like the admin's, and the API plugin ends both sessions on a 401 and adds both generations. `middleware/counter.global.ts` protects `/counter/**` (`public: true` for sign-in) and sends a temporary password to `/counter/change-password`.
- **The customer's account** (`app/features/account/`, D97) is separate from the admin's `useAuth`: its pages post to Better Auth's routes, and `useCustomerAccount()` reads `GET /api/shop/me` in the browser only (the server's pages are the same for everyone). The admin and the store share one Better Auth session per browser.
- **A record's name opens it:** the button holds only the name (the description beside it) and stretches over its row or card (`after:absolute after:inset-0` on a `relative` parent), so its accessible name is the text on it (D152, checked by `accessibility.test.ts`).
- App-wide behavior needs nothing from features: login/logout apply to all open tabs (`plugins/auth-sync.client.ts`), `?` shows keyboard shortcuts, tab titles from `definePageMeta({ title })`, a save in one tab refreshes the same lists in the app's other tabs at once, lists refetch when the user returns to the tab (data ≥ 5s old) or the connection comes back (`plugins/data-freshness.client.ts`), offline banner (`OfflineBanner`), leave guards, a new deployed build offered with Reload (`NewVersionBanner`) and browser errors reported to Workers Logs (`plugins/errors.ts`, D149). Cases: [docs/reference/app-behavior.md](reference/app-behavior.md).
- **Rendering (D95):** the customer site is server-rendered; `/admin/**`, `/counter/**`, `/table/**`, `/checkout` and `/orders/**` are SPAs (`routeRules` `ssr: false`). On a server-rendered page, anything that differs by width is CSS (never `useLayoutContext`), browser storage is read after mounting (`initOnMounted`), and `apiFetch` fetches per request on the server. Nitro serves our `/api` and Better Auth `/api/auth` from the same origin.
- **Light and dark (D96):** light by default, the system setting ignored (`colorMode` in `nuxt.config.ts`); Nuxt UI's `UColorModeButton` in the admin sidebar, the admin's sign-in pages, the store's header and the account pages. Use semantic tokens only, so both modes work.
- `app/layouts/default.vue` is the admin's Nuxt UI dashboard shell; customer pages use `layout: 'shop'` (no sidebar, each page brings its header). The sidebar is `app/utils/navigation.ts`, which groups and orders each feature's exported `navigation` entry.
- Every page component renders a `UDashboardPanel` with the anatomy in [responsive-layout.md → Page anatomy](reference/responsive-layout.md#5-page-anatomy).

## Conventions

- Prefer Nuxt-native tools (`useAsyncData`, `useState`, `useRuntimeConfig`, route middleware), then `@vueuse/core` (import it explicitly: it isn't auto-imported), before adding a library or hand-rolling a utility. There is no Pinia: shared state is `useState` inside a composable.
- Define new API contracts in project-owned code. Import Valibot as `import * as v from 'valibot'`.
- **Local build modules** live in `modules/` (Nuxt registers them): today only `reka-namespaced.ts`, which keeps Reka UI's namespaced barrel from bundling the admin's calendar into the customer menu (D123). Import Nuxt's kit as `nuxt/kit` (pnpm doesn't let the app import `@nuxt/kit` or `vite`).
- Icons are bundled at build time, never fetched (decisions D18). Write icon names as literal strings (`'i-lucide-tags'`), not template strings, and install `@iconify-json/<collection>` before using a new collection.
- `USelect` cannot hold an empty or `undefined` value. Use `ANY` for "all" filters and let the `<Feature>Select` components handle "none".
- **Dropdowns (owner, 2026-10-02, D126):** the cafe's records (categories, branches, rules, add-on groups, staff) or a long list use `<RecordSelect>` (search and virtual scroll, `pinned` "All"/"None"); `USelect` only for a fixed set the code defines (status, role, sort). See [ui.md §14](reference/ui.md#14-dropdowns-owner-2026-10-02-d126).
- **Tabs, pages and quantities (D128):** tab labels are never cut: a row that doesn't fit scrolls and centers the active tab (`useCenteredTab`); every paginated list ends with `<ListPagination>`; every quantity is a `<QuantityStepper>`, never `UInputNumber` ([ui.md §15–16](reference/ui.md#16-pagination-and-quantities-owner-2026-10-02-d128)).
- **Page width (D126):** admin pages set no max-width or width breakpoints: the shell centers them at 80rem; a settings or form page adds `class="page-narrow"` (56rem) to its `UDashboardPanel` ([ui.md §13](reference/ui.md#13-page-width-owner-2026-10-02-d126)). Drawers and sheets are `<AppDrawer>`; tabs in a toolbar are `<ToolbarTabs>` with `useUrlTab`.
- **Design system first (owner, 2026-09-28, D74).** Mockups are a reference for layout, element positions and content, not for styling; Nuxt UI defaults and global configuration decide styling. The rules are in [ui.md](reference/ui.md). When a mockup needs something the design system lacks, ask first.
- The UI chrome is English only. Translatable content fields (`nameI18n`, ...) are data, preserved on update.
