import { getSchedule } from '../../../../legacy/menu/schedules'

/** One schedule with the menu items that follow it. */
export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return getSchedule(useDb(), readIdParam(event, 'id', 'The schedule'))
})
