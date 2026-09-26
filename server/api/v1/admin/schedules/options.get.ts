import { listScheduleOptions } from '../../../../features/menu/schedules'

/** Every schedule (all statuses), for pickers. */
export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return listScheduleOptions(useDb())
})
