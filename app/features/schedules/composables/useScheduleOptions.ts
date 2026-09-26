import { getAll1 } from '~/generated/api'

/** PUBLIC. Every schedule (unpaginated, all statuses) for pickers, e.g. the menu-item form. */
export function useScheduleOptions() {
  return useApiQuery('schedules:options', () => unwrap(getAll1()), { default: () => [] })
}
