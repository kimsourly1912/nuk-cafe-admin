import * as v from 'valibot'

/**
 * `GET /api/admin/me`: the signed-in admin, for the admin app (D52). Only platform admins may use
 * the admin app for now; branch managers and staff get 403 (their screens come with the counter).
 */
export interface AdminSession {
  userId: string
  email: string
  name: string
  role: 'admin'
  /**
   * The platform actions this account may take, as `resource:action` (`menu:write`,
   * `staff:create`). For hiding UI only: the server checks every request itself.
   */
  permissions: string[]
  /**
   * Still on a temporary password: every other admin route answers 403
   * `PASSWORD_CHANGE_REQUIRED` until it's changed, and the app shows the change-password page.
   */
  mustChangePassword: boolean
}

/** Better Auth's limits (`minPasswordLength` / `maxPasswordLength` defaults). */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export const newPasswordSchema = v.pipe(
  v.string(),
  v.minLength(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`),
  v.maxLength(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`),
)

/**
 * `GET /api/counter/me`: the signed-in staff member, for the counter app (step 6.3b, D102): the
 * branches they work at (every active branch for a platform admin). Answers while a temporary
 * password is in place, like `/admin/me`, so the app can ask for a new one. A customer with no
 * branch is 403 `NOT_STAFF`.
 */
export interface CounterSession {
  userId: string
  email: string
  name: string
  mustChangePassword: boolean
  branches: { id: string, name: string, role: 'admin' | 'manager' | 'staff' }[]
}
