import type { Page } from '#shared/contracts/common'
import type { CreateScheduleBody, Schedule, ScheduleDetail, ScheduleListQuery, UpdateScheduleBody } from '#shared/contracts/menu'

export type { ScheduleListQuery }

const NOUN: [string, string] = ['schedule', 'schedules']

/** Update and remove of one schedule must never overlap: both take this record lock. */
const lockOf = (id: string) => `schedule:${id}`

/** Features whose cached data shows schedules (menu items list theirs). */
const AFFECTED = ['schedules', 'products']

/**
 * A schedule menu items follow can't be deleted (the server answers 409 SCHEDULE_IN_USE): what
 * that should do to those items isn't decided (Q16). The list disables Delete for them up front.
 */
export const isLinked = (schedule: Schedule) => schedule.productCount > 0
/** Short, for the disabled Delete item in the row menu. */
export const linkedLabel = (count: number) => `In use by ${pluralize(count, ['menu item', 'menu items'])}`

/** Paginated schedule list. Refetches whenever `query` changes. */
export function useScheduleList(query: MaybeRefOrGetter<ScheduleListQuery>) {
  return useApiQuery('schedules:list', () => apiFetch<Page<Schedule>>('/v1/admin/schedules', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** "All 7 · Active 6 · Inactive 1" for the status tabs, with the other filters applied. */
export function useScheduleStatusCounts(filters: () => Pick<ScheduleListQuery, 'search' | 'day'>) {
  return useStatusCounts('schedules', filters, (query, status) =>
    apiFetch<Page<Schedule>>('/v1/admin/schedules', { query: { ...query, status, pageSize: 1 } }).then(page => page.total))
}

/** One schedule with the menu items that follow it (the list only has their number). */
export function useScheduleDetail(id: MaybeRefOrGetter<string>) {
  return useApiQuery(() => `schedules:detail:${toValue(id)}`, () => apiFetch<ScheduleDetail>(`/v1/admin/schedules/${toValue(id)}`))
}

/** Confirmation for a bulk delete; `keptCount` linked schedules were left out of it. */
export function confirmDeleteMany(schedules: Schedule[], keptCount = 0) {
  const kept = keptCount ? ` ${pluralize(keptCount, NOUN)} in use will be kept.` : ''
  return {
    title: `Delete ${pluralize(schedules.length, NOUN)}?`,
    description: `${previewList(schedules.map(s => s.name))}. This cannot be undone.${kept}`,
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
    (body: CreateScheduleBody) => apiFetch<ScheduleDetail>('/v1/admin/schedules', { method: 'POST', body }),
    {
      id: 'schedules:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.name.trim().toLowerCase(),
      successMessage: (_, body) => `Schedule "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    ({ id, body }: { id: string, name: string, body: UpdateScheduleBody }) =>
      apiFetch<ScheduleDetail>(`/v1/admin/schedules/${id}`, { method: 'PATCH', body }),
    {
      id: 'schedules:update',
      key: ({ id }) => id,
      lock: ({ id }) => lockOf(id),
      successMessage: (_, { name }) => `Schedule "${name}" updated`,
      errorMessage: ({ name }) => `Could not save "${name}"`,
      invalidate: AFFECTED,
    },
  )

  const remove = useMutation(
    // The server refuses a schedule that is in use, also one linked since the list loaded.
    (schedule: Schedule) => apiFetch<null>(`/v1/admin/schedules/${schedule.id}`, { method: 'DELETE', query: { version: schedule.version } }),
    {
      id: 'schedules:remove',
      key: schedule => schedule.id,
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
    isBusy: (id: string) => update.isPending(id) || remove.isPending(id),
  }
}
