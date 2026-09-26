import { scheduleListQuery } from '#shared/contracts/menu'
import { listSchedules } from '../../../../features/menu/schedules'

export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return listSchedules(useDb(), readQueryAs(event, scheduleListQuery))
})
