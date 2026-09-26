import { getSchedule } from '../../../../features/menu/schedules'

/** One schedule with the menu items that follow it. */
export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return getSchedule(useDb(), idParam(getRouterParam(event, 'id'), 'The schedule'))
})
