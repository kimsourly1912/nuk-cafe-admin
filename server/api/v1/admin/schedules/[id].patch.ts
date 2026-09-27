import { updateScheduleBody } from '#shared/contracts/menu'
import { updateSchedule } from '../../../../legacy/menu/schedules'

export default defineEventHandler(async (event) => {
  const staff = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'id', 'The schedule')
  return updateSchedule(useDb(), staff, id, await readValidBody(event, updateScheduleBody))
})
