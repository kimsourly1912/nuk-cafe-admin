import { eq } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { twoFactor, user } from '#server/db/tables'
import type { PlatformRole } from './identity.permissions'

/**
 * The dev accounts task's writes (D209): an account back to a state anyone can sign in with. Only
 * the dev server reaches them (dev-accounts.service.ts).
 */

/**
 * No forced password change, no two-step sign-in, not banned, a verified email. `role` also sets
 * the platform role; without it the account keeps its own.
 */
export function signInResetStatements(db: Db, userId: string, next: Date, role?: PlatformRole): Statement[] {
  return [
    db.update(user)
      .set({ mustChangePassword: false, twoFactorEnabled: false, banned: false, banReason: null, banExpires: null, emailVerified: true, updatedAt: next, ...(role ? { role } : {}) })
      .where(eq(user.id, userId)),
    db.delete(twoFactor).where(eq(twoFactor.userId, userId)),
  ]
}
