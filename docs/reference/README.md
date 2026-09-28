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
| [UI helpers](./ui-helpers.md) | `useConfirm`, `useTableSelection`, `<BottomActionBar>`, `<BulkActionsBar>`, `useLayoutContext`, `previewList`, `pluralize`, `<SearchInput>`, `<ListEmptyState>`, `<StatusTabs>`, money (`toMinor`, `formatMinor`, …), `<ListSkeleton>` |
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
| `<BottomActionBar>` | component | [UI helpers](./ui-helpers.md#bottomactionbar) | The one bottom bar: mode, Save and bulk bars |
| `<BulkActionsBar>` | component | [UI helpers](./ui-helpers.md#bulkactionsbar) | The Select mode bar: "5 selected · Select all · actions · ✕" (a `BottomActionBar`) |
| `useLayoutContext` | composable | [UI helpers](./ui-helpers.md#uselayoutcontext) | `isCompact` / `isExpanded` for choices CSS can't make |
| `<StatusTabs>` | component | [UI helpers](./ui-helpers.md#statustabs) | "All 3 · Active 2 · Archived 1" |
| `<ListSkeleton>` | component | [UI helpers](./ui-helpers.md#listskeleton) | First-load placeholders |
| `<SearchInput>` | component | [UI helpers](./ui-helpers.md#searchinput) | Search as you type (debounced) |
| `<ListEmptyState>` | component | [UI helpers](./ui-helpers.md#listemptystate) | "No X yet" vs "No X match your filters" |
| `previewList`, `pluralize` | util | [UI helpers](./ui-helpers.md#previewlist-and-pluralize) | "Coffee, Tea and 3 more", "3 categories" |
| `toMinor`, `fromMinor`, `formatMinor`, `formatPrice`, `PRICE_FORMAT` | util | [UI helpers](./ui-helpers.md#money-tominor-fromminor-formatminor-formatprice-price_format) | Cents ↔ dollars, "$4.20" |
| `useUnsavedChanges` | composable | [Forms](./forms.md#useunsavedchanges) | Warn before a page form's input is lost |
| `useModalUnsavedChanges` | composable | [Forms](./forms.md#usemodalunsavedchanges) | Same, plus asking before the modal closes |
| `useLeaveGuard` | composable | [Forms](./forms.md#useleaveguard) | App-wide "discard unsaved changes?" check |
| `usePageShortcuts`, `useSubmitShortcut` | composable | [UI helpers](./ui-helpers.md#keyboard-shortcuts) | Keyboard shortcuts; Ctrl/⌘+Enter to save |
| `loginRedirectTarget` | util (auth) | [Auth](./auth.md#loginredirecttarget) | Safe post-login redirect |
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
  <UPagination v-model:page="page" :total="data?.total ?? 0" :items-per-page="pageSize" />
  <BulkActionsBar v-if="selecting" :count="selection.count" :all-selected="selection.allSelected" @toggle-all="selection.toggleAll(!selection.allSelected)" @exit="exitSelect()">
    <UButton label="Archive selected" color="neutral" variant="subtle" :disabled="!selection.count" @click="archiveSelected" />
  </BulkActionsBar>
</template>
```

> The rewards snippet is illustrative: the feature isn't built, and its contract (`shared/contracts/rewards.ts`) and routes come first ([server standard → Features](../server/architecture.md)).

## Keeping this reference current

When you add or change a shared API, update its page here in the same change (see AGENTS.md → "Resuming work"). Each entry follows the same format: **Usage → Type → Parameters → Returns → Examples → Caveats**.
