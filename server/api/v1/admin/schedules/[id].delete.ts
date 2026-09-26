import { versionQuery } from '#shared/contracts/menu'
import { deleteSchedule } from '../../../../features/menu/schedules'

/** `?version=` names the version the client read: a stale delete gets 409. */
export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const id = idParam(getRouterParam(event, 'id'), 'The schedule')
  const { version } = readQueryAs(event, versionQuery)
  await deleteSchedule(useDb(), staff, id, version)
  setResponseStatus(event, 204)
  return null
})
