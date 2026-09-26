import type { GetPageData, ScheduleCreateRequest, ScheduleListResponse, ScheduleUpdateRequest } from '~/generated/api'
import { create1, delete1, getById1, getPage, update1 } from '~/generated/api'

export type ScheduleListQuery = NonNullable<GetPageData['query']>

const NOUN: [string, string] = ['schedule', 'schedules']

/** Update and remove of one schedule must never overlap: both take this record lock. */
const lockOf = (id: number | undefined) => `schedule:${id}`

/** Features whose cached data shows schedules (menu items will list theirs). */
const AFFECTED = ['schedules', 'products']

/**
 * Deleting a schedule that menu items use is deferred: what the backend does to those items is
 * unknown (docs/plans/schedules.md S6).
 */
export const isLinked = (schedule: ScheduleListResponse) => (schedule.item_count ?? 0) > 0
/** Short, for the disabled Delete item in the row menu. */
export const linkedLabel = (count: number) => `In use by ${pluralize(count, ['menu item', 'menu items'])}`
/** For a refused delete: what to do about it. Menu items unlink schedules in their own form. */
export const linkedReason = (count: number) => `${linkedLabel(count)}. Remove it from their schedules first.`

/** Paginated schedule list. Refetches whenever `query` changes. */
export function useScheduleList(query: MaybeRefOrGetter<ScheduleListQuery>) {
  return useApiQuery('schedules:list', () => unwrap(getPage({ query: toValue(query) })), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** "All 7 · Active 6 · Inactive 1" for the status tabs, with the other filters applied. */
export function useScheduleStatusCounts(filters: () => Pick<ScheduleListQuery, 'search' | 'dayOfWeek'>) {
  return useStatusCounts('schedules', filters, (query, status) =>
    unwrap(getPage({ query: { ...query, status, size: 1 } })).then(page => page.totalElements ?? 0))
}

/**
 * One schedule with its `items`, which the list doesn't include. The edit form needs it to keep
 * the items on save (plan S4).
 */
export function useScheduleDetail(id: MaybeRefOrGetter<number>) {
  return useApiQuery(() => `schedules:detail:${toValue(id)}`, () => unwrap(getById1({ path: { id: toValue(id) } })))
}

/** Confirmation for a bulk delete; `keptCount` linked schedules were left out of it. */
export function confirmDeleteMany(schedules: ScheduleListResponse[], keptCount = 0) {
  const kept = keptCount ? ` ${pluralize(keptCount, NOUN)} in use will be kept.` : ''
  return {
    title: `Delete ${pluralize(schedules.length, NOUN)}?`,
    description: `${previewList(schedules.map(s => s.name ?? `#${s.id}`))}. This cannot be undone.${kept}`,
    confirmLabel: 'Delete',
    danger: true,
  }
}

/**
 * Schedule mutations. State is shared app-wide by mutation id, so e.g. a row knows it's
 * being saved even after the edit modal was closed.
 */
export function useScheduleMutations() {
  const create = useMutation(
    (body: ScheduleCreateRequest) => unwrap(create1({ body })),
    {
      id: 'schedules:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.name?.trim().toLowerCase() ?? '',
      successMessage: (_, body) => `Schedule "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: number, body: ScheduleUpdateRequest }) => unwrap(update1({ path: { id }, body })),
    {
      id: 'schedules:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { body }) => `Schedule "${body.name}" updated`,
      errorMessage: ({ body }) => `Could not save "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const remove = useMutation(
    async (schedule: ScheduleListResponse) => {
      // The list's item_count may be stale: a menu item may have been linked since it loaded.
      // Re-read right before deleting and refuse if the schedule is in use (plan S6).
      const current = await unwrap(getById1({ path: { id: schedule.id! } }))
      const linked = current.items?.length ?? 0
      if (linked > 0) throw new ApiError(linkedReason(linked), { kind: 'conflict', status: 0 })
      return unwrap(delete1({ path: { id: schedule.id! } }))
    },
    {
      id: 'schedules:remove',
      key: schedule => schedule.id!,
      lock: schedule => lockOf(schedule.id),
      removes: true,
      confirm: schedule => ({
        title: `Delete "${schedule.name}"?`,
        description: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }),
      successMessage: (_, schedule) => `Schedule "${schedule.name}" deleted`,
      errorMessage: schedule => `Could not delete "${schedule.name}"`,
      invalidate: AFFECTED,
      batch: {
        noun: NOUN,
        verb: ['Deleting', 'deleted'],
        confirm: schedules => confirmDeleteMany(schedules),
      },
    },
  )

  return {
    create,
    update,
    remove,
    /** Any operation in flight for this schedule: disable its row actions. */
    isBusy: (id: number) => update.isPending(id) || remove.isPending(id),
  }
}
