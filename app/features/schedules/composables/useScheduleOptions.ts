import type { ScheduleOption } from '#shared/contracts/menu'

/** PUBLIC. Every schedule (unpaginated, all statuses) for pickers, e.g. the menu-item form. */
export function useScheduleOptions() {
  return useApiQuery('schedules:options', () => apiFetch<ScheduleOption[]>('/admin/schedules/options'), { default: () => [] })
}
