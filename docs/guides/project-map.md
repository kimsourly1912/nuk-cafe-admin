# Project Map

Task-specific instructions extracted from the former root guide. Read applicable sections via [task routing](../../AGENTS.md#load-context-for-the-task); do not load all guides at startup. Linked reference pages own API signatures and detailed behavior.

## What this is

NUK Cafe is one Nuxt full stack app: the customer website, the admin workspace and the cashier workspace, plus our own API (Nitro) with Better Auth, NuxtHub, Drizzle, SQLite locally and D1/R2/KV on Cloudflare. Product scope: [the system blueprint](../plans/system-blueprint.md). **How the server is built: the [server standard](../server/README.md)** (routes `/api/<surface>/…`, `server/features/` with service/repository layers, Better Auth roles and branches, the data model, operations). Build order: [progress.md → Next steps](../progress.md#next-steps-recommended-order).

**Multi-tenant (D134, T1 completed; T3 deferred, [plan](../plans/multi-tenant.md)):** the app is becoming SaaS-ready: one tenant per cafe (a Better Auth organization), `tenant_id` on every tenant-owned table, the tenant in the path (`/c/<slug>/…` pages, D141; `/api/c/<slug>/…` routes, D140), `/platform` for super admins (the platform console, `app/features/platform/`, layout `platform`, on `/api/platform`, D142). **New tables and queries follow the plan's rules:** tenant-owned rows carry `tenant_id`, every query names the tenant, and a two-cafe test proves it.

**Paths (D93, D141):** a cafe's pages live under its address, `/c/<slug>/…` (`app/pages/c/[slug]/`); **paths below are inside the cafe** (`/admin/products` means `/c/<slug>/admin/products`). Links go through `useTenantPath()` (`tenantPath('/admin/products')`); a lint rule refuses a bare cafe page in a link; the old addresses (`/`, `/admin/…`, …) redirect to NUK Cafe's. The platform's pages have no cafe: the account pages, Your cafes (`/cafes`, D144), `/table/<token>` and the platform console (`/platform/**`, super admins only, its own sign-in and session `usePlatformSession`, D142). Moving to another cafe is a full page load. The admin workspace lives under `/admin` (`/admin/login`, `/admin/products`, …); outside the counter and platform routes listed here, the remaining cafe paths form the **customer site**: `/` is the ordering-first menu (`app/features/menu/`, layout `shop`, on `/api/public`), `/table/<token>` a table's QR code, `/checkout` (Review order, D100) and `/orders/<id>` (the order, tracked) and `/orders` (Your orders; `app/features/orders/`, D114), and the customer's account pages (`/sign-in`, `/sign-up`, `/verify-email`, `/email-verified`, `/forgot-password`, `/reset-password`; `app/features/account/`, layout `account`, D97). The **counter workspace** (D102) lives under `/counter` (`/counter/sign-in`, `/counter/change-password`, `/counter` to choose a branch, `/counter/<branchId>` the queue; `app/features/counter/`, layout `counter`), for branch staff, managers and admins.

Every admin screen runs on the standard's `/api/admin` routes (D52): sign-in, **Cafe profile** (the cafe's name and logo, `app/features/cafe/`, D143), Staff, **Sample data** (test data from the UI, local and staging only, `app/features/sample-data/`, D94), **Branch** (settings, hours and dining tables with QR codes, `app/features/branches/`, D91), **Payments** (the riel rate, `app/features/exchange-rates/`, D102), **Telegram** (connected chats, `app/features/notifications/`, D112), **Reports** (`app/features/reports/`, D110, D111), **Promotions** (Marketing: discounts on the menu with an uploaded poster, `app/features/promotions/`, D163, posted to the cafe's channels from a promotion's page, D164), **Channels** (Marketing: the cafe's Telegram channel, `app/features/marketing/`, D164), and the menu's **Menu items**, **Categories**, **Options**, **Add-ons** and **Availability** pages (`app/features/products/`, `categories/`, `option-sets/`, `modifier-groups/`, `availability-rules/`, D66–D70). The pre-standard `/api/v1` menu and its tables were removed in step 3.8b (D71).

The code is **organized by feature** under `app/features/`. `app/features/categories/` is the **reference feature** for composables, mutations and forms: copy its patterns for every new feature (see [Adding a full stack feature](development.md#adding-a-full-stack-feature)). For **paginated list pages**, copy Menu items (card grid + table); for a small library loaded whole, Options or Add-ons (cards, filtered on the client); Categories is a tree (D37). For a **record with its own page** (a route such as `/add-ons/[id]`: breadcrumb, a main column and a settings column, tabs on phones), copy the Add-on group page (D75).

## Shared building blocks (root, auto-imported)

Summary only. Full signatures, options and examples are in **[docs/reference/](../reference/README.md)**.

| What | Where | Use for |
|---|---|---|
| `apiFetch<T>(path, opts)` | `utils/api.ts`, engine `utils/api-fetch.ts` | Every call to our API (`/api` + path; a cafe's surfaces under the page's cafe, `apiPath`): `ApiError` on failure, no retries, session loss and required password change handled |
| `useTenantPath()`, `useTenantSlug()`, `tenantUrl`, `splitTenantUrl` | `composables/`, `utils/tenant-path.ts` | A cafe page's address: `tenantPath('/admin/products')` → `/c/nuk/admin/products` (D141) |
| `useApiQuery(key, handler, opts)` | `composables/` | Every read (see "CRUD state") |
| `useMutation(fn, opts)` | `composables/`, engine in `utils/mutation.ts` | Every create/update/delete, single or batch |
| `useTableSelection`, `BulkActionsBar` | `composables/`, `components/` | Selection for tables, cards and trees (`isSelected`, `toggle`, `toggleAll`); the Select mode bar |
| `TaskFrame` | `components/` | A task-flow page's frame (sign-in, change password, the account pages): a card from `sm`, the full screen with the action at the bottom on phones; CSS only (D84, D97) |
| `BottomActionBar` | `components/` | The one bottom bar for a page's mode, Save or bulk actions (fixed below `lg`, one at a time, steps aside for the keyboard) |
| `useLayoutContext()` | `composables/` | `isCompact` / `isExpanded` for choices CSS can't make (full-screen modal, drawer vs dropdown); never `useMediaQuery` by hand |
| `StatusTabs` | `components/` | Status filter as tabs with counts; each feature names its statuses |
| `ListSkeleton` | `components/` | First-load placeholders (rows or cards) |
| `previewList`, `pluralize`, `changeText` | `utils/text.ts` | "Coffee, Tea and 3 more", "3 categories", "+12%" against a previous number |
| `usePaginatedQuery(filters)` | `composables/` | List state **kept in the URL**: 1-based `page` (UI and API), `query` with `page` + `pageSize`, resets page on filter change, strips `ANY`/'', `isFiltered`, `clearFilters` |
| `ANY`, `toApiQuery` | `utils/query.ts` | "All" option in filter selects (`USelect` can't hold `undefined`) |
| `invalidate(...features)` | `utils/invalidate.ts` | Refetch data after mutations |
| `useConfirm()` | `composables/` | `await confirm({ title, danger: true })` resolves to `boolean` (`useMutation`'s `confirm` uses it) |
| `ApiError`, `getErrorMessage` | `utils/api-error.ts` | One error type for every failure (our API's and Better Auth's formats); `kind`, `code`, `fieldErrors`, a user-safe `message` |
| `useUnsavedChanges`, `useModalUnsavedChanges`, `useLeaveGuard` | `composables/`, `utils/form-value.ts` | "Discard unsaved changes?" for page and modal forms; the route middleware and tab-close plugin use them |
| `draft` option, `<FormDraftAlert>`, `createFormDraftStore` | `useUnsavedChanges`, `components/`, `utils/form-draft.ts` | A long form keeps unsaved input in the browser per cafe, person and record, offered back with Restore after a crash or lost session; `markSaved()` after saving (D151) |
| `mergeFormChanges` | `utils/form-value.ts` | Reload after someone else saved first (409): their version with this input on top, part by part, naming the parts both changed (D153) |
| `<SearchInput>`, `<ListEmptyState>` | `components/` | List toolbar search (as you type) and empty states ("nothing yet" vs "filters hide everything") |
| `invalidateAll()`, `invalidateInThisTab()` | `utils/invalidate.ts` | Refetch loaded or only stale queries / invalidate without telling other tabs (used by the freshness plugin) |
| `usePageShortcuts`, `useSubmitShortcut`, `SHORTCUTS`, `<ShortcutsHelp>` | `composables/useShortcuts.ts`, `components/` | Keyboard shortcuts (skipped behind dialogs/menus), Ctrl/⌘+Enter to save, the `?` list |
| `useNotify()` | `composables/` | Toasts for API actions that aren't mutations |
| `toMinor`, `fromMinor`, `formatMinor`, `formatPrice`, `PRICE_FORMAT`, `CURRENCY` | `utils/money.ts` | Cents (API) ↔ dollars (forms, display), "$4.20" |
| `timezoneOptions`, `utcOffset`, `cityOf` | `utils/timezones.ts` | Time zone pickers: "(GMT+07:00) Phnom Penh" by offset (the Branch form, New cafe, D142) |
| `formatClock`, `timeRange`, `isOvernight`, `minuteToTime`, `timeToMinute` | `utils/clock.ts` | Weekly windows' minutes after midnight ↔ "7:30 AM" and `<TimeInput>` (availability rules, branch hours) |
| `TimeInput` | `components/` | Every time of day: `UInputTime` with AM/PM switched by a tap, which a phone's keyboard can't type (`UInputTime` is a lint error elsewhere, D165) |
| `useFormErrorRecheck` | `composables/` | Every `UForm`: errors leave as soon as they're fixed, a rule across fields too; server errors stay until their field changes (D166) |
| `useReorderTransition` | `composables/` | A reorder list's rows slide to their new place when moved by their chevrons or keys (`<TransitionGroup :move-class>` + Sortable's `onStart`/`onEnd`, D165) |
| `ApiErrorAlert` | `components/` | Load-error alert with Retry |
| `StatCard` | `components/` | One number on a page, in a soft card (never a number styled by hand) |
| `RecordSelect` | `components/` | A dropdown of records: `USelectMenu` with search and virtual scroll, `pinned` "All"/"None"; a combobox, like `USelect` (D152) |
| `adminSetupSteps()`, `AdminSetupStep` | `utils/admin-setup.ts`, `types/admin-setup.ts` | The home page's "Set up your cafe": each feature exports its step from its index.ts, listed here in order (D155) |
| `adminSearchSources()`, `AdminSearch`, `AdminSearchSource` | `utils/admin-search.ts`, `components/`, `types/admin-search.ts` | Ctrl/⌘+K search in the admin: each feature exports a source from its index.ts, listed here like the sidebar (D152) |
| `AppDrawer` | `components/` | Every drawer and bottom sheet: `UDrawer` without a handle or dragging (`UDrawer` is a lint error elsewhere) |
| `ToolbarTabs`, `useUrlTab` | `components/`, `composables/` | Tabs on a toolbar's line; a page's tab in the URL (`?tab=`) |
| `ListPagination` | `components/` | The pager of every paginated list: "Page [n] of N · Rows per page", page numbers; `pageSize` in the URL (D128) |
| `QuantityStepper` | `components/` | Every quantity: − n + in a pill, no keyboard on touch screens (D128) |
| `useCenteredTab` | `composables/` | A scrolling tab row keeps its active tab in the middle (`StatusTabs`, `ToolbarTabs` call it) (D128) |
| `QrCode`, `qrImage`, `qrSvg` | `components/`, `utils/qr-code.ts` | A QR code drawn as SVG, dark on light in both themes: a table's link, an order's KHQR (D130) |
| `fetchAccountCafes`, `otherCafes`, `workspaceUrl`, `worksElsewhere`, `CAFES_PATH` | `utils/account-cafes.ts` | The signed-in account's cafes (`GET /api/me/cafes`) for Your cafes, the switcher and a sign-in refused at the wrong cafe; another cafe always opens as a full page load (D141, D144) |
| `useCafe()`, `CafeLogo` | `composables/`, `components/` | The cafe's name and logo (`GET /api/cafes/{slug}`): **never write a cafe's name into a page** (D143) |
| `ImageInput`, `useImageUpload`, `shrinkImage` | `components/`, `composables/`, `utils/` | An image for a record (the cafe's logo): shrunk in the browser, uploaded on pick through `POST /admin/media` (D122, D143) |
| `MenuItemImage` | `components/` | **Every menu item photo** (D158): `usage="card"` (square) or `"detail"` (4:3, two sizes), blurred placeholder, lazy, fade-in; never a bare `<img>` for a menu photo. Photos are made by the products feature's photo editor (`POST /admin/media/photos`) |
| `OrderLinePromotion` | `components/` | An order line's promotion as sold ("20% off · Coffee week · was $7.00"): the customer's order, the counter, Order history (D163) |
| `PhoneInput`, `parsePhone` / `phoneSchema` | `components/`, `shared/contracts/phone.ts` | Every phone number: a country (flag, dial code) and the number; stored and sent as E.164, checked by libphonenumber on both sides (D127) |


