import { and, eq, exists, not, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { firstRow } from '#server/utils/query'
import { account, branchStaff, member, session, twoFactor, user, verification } from '#server/db/tables'

/** What a deleted account is called on the orders it leaves (D237). */
export const DELETED_ACCOUNT_NAME = 'Deleted account'

/** A unique address nobody can receive mail at, so the real one is free for a new sign-up. */
export const deletedEmail = (userId: string) => `deleted-${userId}@anonymous.invalid`

/** Across cafes: the account is a member of a cafe, or works at a branch (D134). */
function hasCafeAccess(db: Db): SQL {
  return or(
    exists(db.select({ id: member.id }).from(member).where(eq(member.userId, user.id))),
    exists(db.select({ userId: branchStaff.userId }).from(branchStaff).where(eq(branchStaff.userId, user.id))),
  )!
}

/** A super admin (`role` is Better Auth's comma list, `staff.rules.ts` → `isSuperadmin`). */
const platformRole = sql`instr(',' || replace(coalesce(${user.role}, ''), ' ', '') || ',', ',superadmin,') > 0`

export interface ErasureFacts {
  email: string
  emailVerified: boolean
  anonymized: boolean
  superadmin: boolean
  cafeAccess: boolean
}

/** The account as deletion checks it, in one read. */
export async function erasureFacts(db: Db, userId: string): Promise<ErasureFacts | undefined> {
  const row = await firstRow(db.select({
    email: user.email,
    emailVerified: user.emailVerified,
    anonymizedAt: user.anonymizedAt,
    superadmin: sql<number>`${platformRole}`,
    cafeAccess: sql<number>`${hasCafeAccess(db)}`,
  }).from(user).where(eq(user.id, userId)))
  if (!row) return undefined
  return {
    email: row.email,
    emailVerified: row.emailVerified,
    anonymized: row.anonymizedAt !== null,
    superadmin: Boolean(row.superadmin),
    cafeAccess: Boolean(row.cafeAccess),
  }
}

/**
 * Replaces who the account was (D237): name, email, picture; marks it deleted. Only if it is still
 * at the email read (so not deleted meanwhile), with no cafe access and no platform role:
 * follow it with `requireOneChange`. The row stays, since orders and payments reference it.
 */
export function eraseAccountStatement(db: Db, userId: string, email: string, now: Date): Statement {
  return db.update(user)
    .set({ name: DELETED_ACCOUNT_NAME, email: deletedEmail(userId), emailVerified: false, image: null, anonymizedAt: now, updatedAt: now })
    .where(and(
      eq(user.id, userId),
      // Also "not deleted yet": deleting replaces the email.
      eq(user.email, email),
      not(hasCafeAccess(db)),
      not(platformRole),
    ))
}

/** Every way back in: sessions (signed out everywhere), the password, two-step sign-in, reset links. */
export function deleteSignInStatements(db: Db, userId: string): Statement[] {
  return [
    db.delete(session).where(eq(session.userId, userId)),
    db.delete(account).where(eq(account.userId, userId)),
    db.delete(twoFactor).where(eq(twoFactor.userId, userId)),
    // Better Auth's password-reset rows hold the account's id as their value.
    db.delete(verification).where(eq(verification.value, userId)),
  ]
}
