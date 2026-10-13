# API Reference

Reference for the shared building blocks of the NUK Cafe admin portal: the composables, utilities and components every feature is built from.

> The admin UI calls our own API (`/api`, served by this app) with [`apiFetch`](./data-fetching.md#apifetch). Routes, error format and server structure: the [server standard](../server/README.md). Contracts live in `shared/contracts/`.

> The reference feature `app/features/categories/` uses everything documented here. When in doubt, read how Categories does it.

## Pages

| Page | Contents |
|---|---|
| [UI foundation](./ui.md) | **Canonical visual rules**: tokens, spacing, radius, type, density and touch targets, icons, surfaces, action hierarchy, motion, accessibility |
| [Responsive layout](./responsive-layout.md) | Width classes (compact/medium/expanded), shell and navigation, page anatomy, sticky bars, the responsive behavior matrix |
| [Page patterns](./page-patterns.md) | Resource index, settings, detail/editor and task-flow blueprints; editing surfaces; bottom sheets; gestures; the states every page handles |
| [UI review checklist](./ui-review-checklist.md) | Run before merging UI work: widths, keyboard, touch, focus, states, tests |
| [Data fetching](./data-fetching.md) | `apiFetch`, `useApiQuery`, `usePaginatedQuery` (URL sync), `ANY` / `toApiQuery`, `invalidate` (also other tabs), `invalidateInThisTab`, `invalidateAll` |
| [Mutations](./mutations.md) | `useMutation` (create/update/delete, single and batch), `usePendingMutationCount` |
| [Errors](./errors.md) | `ApiError`, `getErrorMessage`, `isSilentError`, error codes, `<ApiErrorAlert>`, `useNotify` |
| [UI helpers](./ui-helpers.md) | `useConfirm`, `useTableSelection`, `<TaskFrame>`, `<BottomActionBar>`, `<BulkActionsBar>`, `useLayoutContext`, `previewList`, `pluralize`, `<SearchInput>`, `<ListEmptyState>`, `<StatusTabs>`, money (`toMinor`, `formatMinor`, …), `<ListSkeleton>`, `<StatCard>`, `<RecordSelect>`, `<AppDrawer>`, `<TimeInput>`, `useReorderTransition`, `<ToolbarTabs>`, `useUrlTab`, `useCenteredTab`, `<ListPagination>`, `<QuantityStepper>` |
| [App-wide behavior](./app-behavior.md) | Tab titles, refresh on tab focus/reconnect, offline banner, leave guards, session loss: every case handled |
| [Forms: unsaved changes](./forms.md) | `useUnsavedChanges`, `useModalUnsavedChanges`, `useLeaveGuard`, `isSameFormValue` |
| [Auth](./auth.md) | `useAuth`, public pages |
| [Feature public APIs](./features.md) | What each feature exports for other features (`CategorySelect`, `useCategoryOptions`, …) |

## All APIs at a glance

| API | Kind | Page | One-liner |
|---|---|---|---|
| `useApiQuery` | composable | [Data fetching](./data-fetching.md#useapiquery) | Read data. `useAsyncData` + boolean states + `ApiError` |
| `usePaginatedQuery` | composable | [Data fetching](./data-fetching.md#usepaginatedquery) | Filters + 1-based page → API query |
| `ANY`, `toApiQuery` | util | [Data fetching](./data-fetching.md#any--toapiquery) | "All" option for filter selects |
| `apiFetch` | util | [Data fetching](./data-fetching.md#apifetch) | Call our API (`/api`); throws `ApiError` |
| `invalidate` | util | [Data fetching](./data-fetching.md#invalidate) | Refresh a feature's cached data |
| `invalidateAll` | util | [Data fetching](./data-fetching.md#invalidateall) | Refresh loaded (or only stale) queries in this tab |
| `invalidateInThisTab` | util | [Data fetching](./data-fetching.md#invalidateinthistab) | `invalidate` without telling other tabs |
| `useMutation` | composable | [Mutations](./mutations.md#usemutation) | Create/update/delete with every UI state handled |
| `usePendingMutationCount` | composable | [Mutations](./mutations.md#usependingmutationcount) | Number of writes in flight app-wide |
| `ApiError` | class | [Errors](./errors.md#apierror) | The one error type |
| `getErrorMessage` | util | [Errors](./errors.md#geterrormessage) | User-safe message for anything thrown |
| `isSilentError` | util | [Errors](./errors.md#issilenterror) | Errors that must not toast |
| `<ApiErrorAlert>` | component | [Errors](./errors.md#apierroralert) | Failed-load alert with Retry |
| `useNotify` | composable | [Errors](./errors.md#usenotify) | Toasts for non-mutation actions |
| `useConfirm` | composable | [UI helpers](./ui-helpers.md#useconfirm) | `await confirm({...})` → boolean |
| `useTableSelection` | composable | [UI helpers](./ui-helpers.md#usetableselection) | Selection for tables, card grids and trees |
| `<TaskFrame>` | component | [UI helpers](./ui-helpers.md#taskframe) | A task-flow page's frame: a card from `sm`, the full screen with the action at the bottom on phones |
| `<BottomActionBar>` | component | [UI helpers](./ui-helpers.md#bottomactionbar) | The one bottom bar: mode, Save and bulk bars |
| `<BulkActionsBar>` | component | [UI helpers](./ui-helpers.md#bulkactionsbar) | The Select mode bar: "5 selected · Select all" and the actions; Select mode left from its toolbar toggle (D129) (a `BottomActionBar`) |
| `useLayoutContext` | composable | [UI helpers](./ui-helpers.md#uselayoutcontext) | `isCompact` / `isExpanded` for choices CSS can't make |
| `<StatusTabs>` | component | [UI helpers](./ui-helpers.md#statustabs) | "All 3 · Active 2 · Archived 1" |
| `<StatCard>` | component | [UI helpers](./ui-helpers.md#statcard) | One number on a page, in a soft card |
| `<OrderLinePromotion>` | component | [UI helpers](./ui-helpers.md#orderlinepromotion) | An order line's promotion as sold: "20% off · Coffee week · was $7.00" (D163) |
| `<RecordSelect>` | component | [UI helpers](./ui-helpers.md#recordselect) | A searchable, virtualized dropdown of records |
| `<AppDrawer>` | component | [UI helpers](./ui-helpers.md#appdrawer) | `UDrawer` without dragging: every drawer and bottom sheet |
| `<TimeInput>` | component | [UI helpers](./ui-helpers.md#times-of-day-formatclock-timerange-isovernight-minutetotime-timetominute) | `UInputTime` with AM/PM switched by a tap (phones) |
| `useFormErrorRecheck` | composable | [Forms](./forms.md#useformerrorrecheck) | Every `UForm`: an error leaves as soon as it's fixed, a rule across fields too |
| `useReorderTransition` | composable | [UI helpers](./ui-helpers.md#usereordertransition) | Reorder rows slide to their new place when moved by a button or key |
| `<ToolbarTabs>` | component | [UI helpers](./ui-helpers.md#toolbartabs) | Tabs on a toolbar's line |
| `useUrlTab` | composable | [UI helpers](./ui-helpers.md#useurltab) | A page's tab in the URL (`?tab=`) |
| `useCenteredTab` | composable | [UI helpers](./ui-helpers.md#usecenteredtab) | A scrolling tab row keeps its active tab in the middle (D128) |
| `<ListPagination>` | component | [UI helpers](./ui-helpers.md#listpagination) | "Page [3] of 10 · Rows per page" and the page numbers; every paginated list (D128) |
| `<QuantityStepper>` | component | [UI helpers](./ui-helpers.md#quantitystepper) | − n + in a pill, no keyboard on touch screens (D128) |
| `<QrCode>`, `qrImage`, `qrSvg` | component, util | [UI helpers](./ui-helpers.md#qrcode) | A QR code (a table's link, a KHQR), dark on light in both themes (D130) |
| `<ImageInput>`, `useImageUpload`, `shrinkImage` | component, composable, util | [UI helpers](./ui-helpers.md#imageinput) | An image for a record (the cafe's logo): shrunk, uploaded on pick, Replace and Remove (D143) |
| `<MenuItemImage>` | component | [UI helpers](./ui-helpers.md#menuitemimage) | A menu item's photo by usage (`card` square, `detail` 4:3 with two sizes), blurred placeholder, lazy, fade-in (D158) |
| `useAccountCafes`, `<CafeSwitcher>`, `otherCafes`, `workspaceUrl` | composable, component, utils | [UI helpers](./ui-helpers.md#your-cafes-and-the-switcher) | The account's cafes, Your cafes and the switcher; another cafe is a full page load (D144) |
| `useCafe`, `<CafeLogo>` | composable, component | [UI helpers](./ui-helpers.md#usecafe-and-cafelogo) | The cafe's name and logo, never written into a page (D143) |
| `<PhoneInput>`, `parsePhone` | component, shared util | [UI helpers](./ui-helpers.md#phoneinput) | A phone number with its country; E.164 on the wire (D127) |
| `<ListSkeleton>` | component | [UI helpers](./ui-helpers.md#listskeleton) | First-load placeholders |
| `<SearchInput>` | component | [UI helpers](./ui-helpers.md#searchinput) | Search as you type (debounced) |
| `<ListEmptyState>` | component | [UI helpers](./ui-helpers.md#listemptystate) | "No X yet" vs "No X match your filters" |
| `previewList`, `pluralize`, `changeText` | util | [UI helpers](./ui-helpers.md#previewlist-and-pluralize) | "Coffee, Tea and 3 more", "3 categories", "+12%" |
| `toMinor`, `fromMinor`, `formatMinor`, `formatPrice`, `PRICE_FORMAT` | util | [UI helpers](./ui-helpers.md#money-tominor-fromminor-formatminor-formatprice-price_format) | Cents ↔ dollars, "$4.20" |
| `formatClock`, `timeRange`, `isOvernight`, `minuteToTime`, `timeToMinute` | util | [UI helpers](./ui-helpers.md#times-of-day-formatclock-timerange-isovernight-minutetotime-timetominute) | Minutes after midnight ↔ "7:30 AM" and `UInputTime` |
| `useUnsavedChanges` | composable | [Forms](./forms.md#useunsavedchanges) | Warn before a page form's input is lost |
| `useModalUnsavedChanges` | composable | [Forms](./forms.md#usemodalunsavedchanges) | Same, plus asking before the modal closes |
| `useLeaveGuard` | composable | [Forms](./forms.md#useleaveguard) | App-wide "discard unsaved changes?" check |
| `usePageShortcuts`, `useSubmitShortcut` | composable | [UI helpers](./ui-helpers.md#keyboard-shortcuts) | Keyboard shortcuts; Ctrl/⌘+Enter to save |
| `useTenantPath`, `useTenantSlug`, `tenantUrl`, `splitTenantUrl` | composable, util | [App-wide behavior](./app-behavior.md#cafe-addresses) | A cafe's page address: `tenantPath('/admin/products')` → `/c/nuk/admin/products` (D141) |
| `loginRedirectTarget` | util (auth) | [Auth](./auth.md#loginredirecttarget) | Safe post-login redirect (this cafe's admin pages only) |
| `useAuth` | composable | [Auth](./auth.md#useauth) | Session user, login, logout |

## Conventions that apply everywhere

- **Auto-imported:** everything in `app/composables/`, `app/utils/` and `app/components/` is available without imports in app code. Feature code (`app/features/**`) is **not** auto-imported: import it relatively inside the feature, or from `~/features/<name>` elsewhere.
- **Reactive return objects:** `useMutation`, `useTableSelection` and `useAuth().user` return reactive objects. **Don't destructure `useMutation` or `useTableSelection` results**, or you lose reactivity. Use `remove.pending`, `selection.count`.
- **Keys are `<feature>:<name>`.** Query keys and mutation ids share this namespace, so `invalidate('<feature>')` finds them.
- **Never duplicate request state:** no hand-rolled request `loading` refs, in-flight tracking, try/catch-and-toast, or `useToast()` for API calls. Reads use `useApiQuery`, writes use `useMutation`. A form's own submission state (`saving`) is fine ([feature-standard.md §5](../feature-standard.md#form-local-vs-shared-pending-state)).

## Quick start: a complete list page

The minimal shape of a feature list page, with filters, pagination, load errors, delete with confirmation, busy rows and batch delete. Details are on each API's page.

```ts
// features/rewards/composables/useRewards.ts
import type { Page } from '#shared/contracts/common'
import type { Reward, RewardListQuery } from '#shared/contracts/rewards' // written with the route

export function useRewardList(query: MaybeRefOrGetter<RewardListQuery>) {
  return useApiQuery('rewards:list', () => apiFetch<Page<Reward>>('/admin/rewards', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}

export function useRewardMutations() {
  const remove = useMutation(
    (reward: Reward) => apiFetch<null>(`/admin/rewards/${reward.id}`, { method: 'DELETE', query: { version: reward.version } }),
    {
      id: 'rewards:remove',
      key: reward => reward.id,
      removes: true,
      confirm: reward => ({ title: `Delete "${reward.title}"?`, confirmLabel: 'Delete', danger: true }),
      successMessage: (_, reward) => `Reward "${reward.title}" deleted`,
      errorMessage: reward => `Could not delete "${reward.title}"`,
      invalidate: ['rewards'],
      batch: { noun: ['reward', 'rewards'], verb: ['Deleting', 'deleted'] },
    },
  )
  return { remove, isBusy: (id: string) => remove.isPending(id) }
}
```

```vue
<!-- features/rewards/components/RewardListPage.vue -->
<script setup lang="ts">
import { useRewardList, useRewardMutations } from '../composables/useRewards'

const { page, pageSize, filters, query } = usePaginatedQuery({ search: '', status: ANY as Status | Any })
const { data, loading, error, refresh } = useRewardList(query)
const { remove, isBusy } = useRewardMutations()

const rows = computed(() => (data.value?.items ?? []).filter(r => !remove.isRemoved(r.id)))
const selection = useTableSelection(rows, r => r.id, { resetOn: [query] })

async function removeSelected() {
  const result = await remove.executeMany(selection.selected)
  selection.select(result.failed.map(f => f.input.id))
}
</script>

<template>
  <!-- inside UDashboardPanel #body -->
  <StatusTabs v-model="filters.status" :tabs="TABS" :counts="counts" />
  <ApiErrorAlert v-if="error" :error="error" title="Could not load rewards" @retry="refresh()" />
  <ListSkeleton v-else-if="loading" label="Loading rewards…" variant="card" />
  <ListEmptyState v-else-if="!rows.length" noun="rewards" ... />
  <!-- cards (RewardCard, like ProductCard) or a UTable, by what the screen is for (list-ui-refresh.md) -->
  <ListPagination v-model:page="page" v-model:page-size="pageSize" :total="data?.total ?? 0" />
  <BulkActionsBar v-if="selecting" :count="selection.count" :all-selected="selection.allSelected" @toggle-all="selection.toggleAll(!selection.allSelected)" @exit="exitSelect()">
    <UButton label="Archive selected" color="neutral" variant="subtle" :disabled="!selection.count" @click="archiveSelected" />
  </BulkActionsBar>
</template>
```

> The rewards snippet is illustrative: the feature isn't built, and its contract (`shared/contracts/rewards.ts`) and routes come first ([server standard → Features](../server/architecture.md)).

## Keeping this reference current

When you add or change a shared API, update its page here in the same change (see AGENTS.md → "Keep these documents current"). Each entry follows the same format: **Usage → Type → Parameters → Returns → Examples → Caveats**.

<!-- moved from AGENTS.md: shared building blocks -->
## Root shared blocks: usage rules (moved from AGENTS.md)

_Moved verbatim from AGENTS.md ("Shared building blocks"). The table carries rules, not only names: for example **never write a cafe's name into a page** (`useCafe()`), **never a bare `<img>` for a menu photo** (`MenuItemImage`), `UInputTime` and `UDrawer` are lint errors, never `useMediaQuery` by hand, every quantity a `QuantityStepper`._

Summary only. Full signatures, options and examples are in **[docs/reference/](README.md)**.

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
