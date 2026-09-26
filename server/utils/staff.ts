import type { H3Event } from 'h3'
import type { Permission, StaffSession } from '#shared/contracts/identity'
import { authorizeStaff } from '../features/identity/service'
import { apiError } from './api-error'
import { useDb } from './db'

/**
 * Every admin route starts with this: the Better Auth session, then the staff profile and the
 * permission (401 / 403 NOT_STAFF / 403 FORBIDDEN). The staff profile is loaded once per request.
 */
export async function requireStaff(event: H3Event, permission?: Permission): Promise<StaffSession> {
  let staff = event.context.staff as StaffSession | undefined
  if (!staff) {
    const session = await getUserSession(event)
    staff = await authorizeStaff(useDb(), session?.user?.id)
    event.context.staff = staff
  }
  if (permission && !staff.permissions.includes(permission)) {
    throw apiError(403, 'FORBIDDEN', 'You don\'t have permission to do this.')
  }
  return staff
}
