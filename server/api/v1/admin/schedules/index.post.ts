import { createScheduleBody } from '#shared/contracts/menu'
import { createSchedule } from '../../../../legacy/menu/schedules'

export default defineEventHandler(async (event) => {
  const staff = await requirePermission(event, { menu: ['write'] })
  const input = await readValidBody(event, createScheduleBody)
  const schedule = await createSchedule(useDb(), staff, input, useRuntimeConfig(event).public.cafeTimeZone)
  setResponseStatus(event, 201)
  return schedule
})
