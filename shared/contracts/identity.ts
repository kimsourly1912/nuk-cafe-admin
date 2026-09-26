import * as v from 'valibot'

export const STAFF_ROLES = ['admin'] as const
export type StaffRole = typeof STAFF_ROLES[number]

/**
 * Permissions checked by the server on every admin route. The UI may hide actions with them;
 * it never grants anything. Only `admin` exists until the role matrix is decided (Q6, D40).
 */
export const PERMISSIONS = ['menu.read', 'menu.write', 'media.write'] as const
export type Permission = typeof PERMISSIONS[number]

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  admin: PERMISSIONS,
}

/** `GET /api/v1/admin/me`: the signed-in staff member. */
export interface StaffSession {
  userId: string
  email: string
  displayName: string
  role: StaffRole
  permissions: Permission[]
}

/** `POST /api/v1/bootstrap/admin`: makes an existing account the first admin. */
export const bootstrapAdminBody = v.strictObject({
  token: v.pipe(v.string(), v.minLength(1, 'Required')),
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email('Must be an email address')),
  displayName: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100))),
})
export type BootstrapAdminBody = v.InferOutput<typeof bootstrapAdminBody>
