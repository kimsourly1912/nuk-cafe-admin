import { createScheduleBody } from '#shared/contracts/menu'
import { createSchedule } from '../../../../features/menu/schedules'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const input = await readBodyAs(event, createScheduleBody)
  const schedule = await createSchedule(useDb(), staff, input, useRuntimeConfig(event).public.cafeTimeZone)
  setResponseStatus(event, 201)
  return schedule
})
