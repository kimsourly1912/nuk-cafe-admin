import { scheduleListQuery } from '#shared/contracts/menu'
import { listSchedules } from '../../../../legacy/menu/schedules'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return listSchedules(useDb(), readValidQuery(event, scheduleListQuery))
})
