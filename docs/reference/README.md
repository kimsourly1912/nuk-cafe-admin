# API Reference

Reference for the shared building blocks of the NUK Cafe admin portal: the composables, utilities and components every feature is built from.

> The reference feature `app/features/categories/` uses everything documented here. When in doubt, read how Categories does it.

## Pages

| Page | Contents |
|---|---|
| [Data fetching](./data-fetching.md) | `useApiQuery`, `usePaginatedQuery`, `ANY` / `toApiQuery`, `unwrap`, `invalidate` |
| [Mutations](./mutations.md) | `useMutation` (create/update/delete, single and batch), `usePendingMutationCount` |
| [Errors](./errors.md) | `ApiError`, `getErrorMessage`, `isSilentError`, error codes, `<ApiErrorAlert>`, `useNotify` |
| [UI helpers](./ui.md) | `useConfirm`, `useTableSelection`, `<BulkActionsBar>`, `<StatusBadge>`, status constants, `previewList`, `pluralize` |
| [Auth](./auth.md) | `useAuth`, public pages |
| [Feature public APIs](./features.md) | What each feature exports for other features (`CategorySelect`, `useCategoryOptions`, …) |

## All APIs at a glance

| API | Kind | Page | One-liner |
|---|---|---|---|
| `useApiQuery` | composable | [Data fetching](./data-fetching.md#useapiquery) | Read data. `useAsyncData` + boolean states + `ApiError` |
| `usePaginatedQuery` | composable | [Data fetching](./data-fetching.md#usepaginatedquery) | Filters + 1-based page → API query |
| `ANY`, `toApiQuery` | util | [Data fetching](./data-fetching.md#any--toapiquery) | "All" option for filter selects |
| `unwrap` | util | [Data fetching](./data-fetching.md#unwrap) | SDK call → envelope `data` |
| `invalidate` | util | [Data fetching](./data-fetching.md#invalidate) | Refresh a feature's cached data |
| `useMutation` | composable | [Mutations](./mutations.md#usemutation) | Create/update/delete with every UI state handled |
| `usePendingMutationCount` | composable | [Mutations](./mutations.md#usependingmutationcount) | Number of writes in flight app-wide |
| `ApiError` | class | [Errors](./errors.md#apierror) | The one error type |
| `getErrorMessage` | util | [Errors](./errors.md#geterrormessage) | User-safe message for anything thrown |
| `isSilentError` | util | [Errors](./errors.md#issilenterror) | Errors that must not toast |
| `<ApiErrorAlert>` | component | [Errors](./errors.md#apierroralert) | Failed-load alert with Retry |
| `useNotify` | composable | [Errors](./errors.md#usenotify) | Toasts for non-mutation actions |
| `useConfirm` | composable | [UI helpers](./ui.md#useconfirm) | `await confirm({...})` → boolean |
| `useTableSelection` | composable | [UI helpers](./ui.md#usetableselection) | `UTable` row checkboxes |
| `<BulkActionsBar>` | component | [UI helpers](./ui.md#bulkactionsbar) | "5 selected · actions · Clear" |
| `<StatusBadge>`, `STATUS_*` | component, consts | [UI helpers](./ui.md#statusbadge-and-status-constants) | ACTIVE/INACTIVE display and selects |
| `previewList`, `pluralize` | util | [UI helpers](./ui.md#previewlist-and-pluralize) | "Coffee, Tea and 3 more", "3 categories" |
| `useAuth` | composable | [Auth](./auth.md#useauth) | Session user, login, logout |

## Conventions that apply everywhere

- **Auto-imported:** everything in `app/composables/`, `app/utils/` and `app/components/` is available without imports in app code. Feature code (`app/features/**`) is **not** auto-imported: import it relatively inside the feature, or from `~/features/<name>` elsewhere.
- **Reactive return objects:** `useMutation`, `useTableSelection` and `useAuth().user` return reactive objects. **Don't destructure `useMutation` or `useTableSelection` results**, or you lose reactivity. Use `remove.pending`, `selection.count`.
- **Keys are `<feature>:<name>`.** Query keys and mutation ids share this namespace, so `invalidate('<feature>')` finds them.
- **Never hand-roll** `loading` refs, try/catch-and-toast, or `useToast()` for API calls. Reads use `useApiQuery`, writes use `useMutation`.

## Quick start: a complete list page

The minimal shape of a feature list page, with filters, pagination, load errors, delete with confirmation, busy rows and batch delete. Details are on each API's page.

```ts
// features/rewards/composables/useRewards.ts
import type { RewardCatalogItemResponse, RewardsData } from '~/generated/api'
import { deleteReward, rewards as getRewardsPage } from '~/generated/api'

export function useRewardList(query: MaybeRefOrGetter<NonNullable<RewardsData['query']>>) {
  return useApiQuery('rewards:list', () => unwrap(getRewardsPage({ query: toValue(query) })), {
    watch: [() => ({ ...toValue(query) })],
  })
}

export function useRewardMutations() {
  const remove = useMutation(
    (reward: RewardCatalogItemResponse) => unwrap(deleteReward({ path: { id: reward.id! } })),
    {
      id: 'rewards:remove',
      key: reward => reward.id!,
      removes: true,
      confirm: reward => ({ title: `Delete "${reward.title}"?`, confirmLabel: 'Delete', danger: true }),
      successMessage: (_, reward) => `Reward "${reward.title}" deleted`,
      errorMessage: reward => `Could not delete "${reward.title}"`,
      invalidate: ['rewards'],
      batch: { noun: ['reward', 'rewards'], verb: ['Deleting', 'deleted'] },
    },
  )
  return { remove, isBusy: (id: number) => remove.isPending(id) }
}
```

```vue
<!-- features/rewards/components/RewardListPage.vue -->
<script setup lang="ts">
import { useRewardList, useRewardMutations } from '../composables/useRewards'

const { page, pageSize, filters, query } = usePaginatedQuery({ search: '', status: ANY as Status | Any })
const { data, loading, error, refresh } = useRewardList(query)
const { remove, isBusy } = useRewardMutations()

const rows = computed(() => (data.value?.content ?? []).filter(r => !remove.isRemoved(r.id!)))
const selection = useTableSelection(rows, r => r.id!, { resetOn: [query] })

async function removeSelected() {
  const result = await remove.executeMany(selection.selected)
  selection.select(result.failed.map(f => f.input.id!))
}
</script>

<template>
  <BulkActionsBar :count="selection.count" @clear="selection.clear()">
    <UButton label="Delete" color="error" variant="subtle" @click="removeSelected" />
  </BulkActionsBar>
  <ApiErrorAlert v-if="error" :error="error" title="Could not load rewards" @retry="refresh()" />
  <UTable v-else v-model:row-selection="selection.rowSelection" :get-row-id="selection.getRowId"
          :data="rows" :loading="loading" ... />
  <UPagination v-model:page="page" :total="data?.totalElements ?? 0" :items-per-page="pageSize" />
</template>
```

> The rewards snippet is illustrative (the feature isn't built yet). SDK names come from `app/generated/api/sdk.gen.ts`: search for the URL (`url: '/staff/rewards'`).

## Keeping this reference current

When you add or change a shared API, update its page here in the same change (see AGENTS.md → "Resuming work"). Each entry follows the same format: **Usage → Type → Parameters → Returns → Examples → Caveats**.
