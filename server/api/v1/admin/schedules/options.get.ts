import { listScheduleOptions } from '../../../../legacy/menu/schedules'

/** Every schedule (all statuses), for pickers. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return listScheduleOptions(useDb())
})
