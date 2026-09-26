import { updateScheduleBody } from '#shared/contracts/menu'
import { updateSchedule } from '../../../../features/menu/schedules'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const id = idParam(getRouterParam(event, 'id'), 'The schedule')
  return updateSchedule(useDb(), staff, id, await readBodyAs(event, updateScheduleBody))
})
