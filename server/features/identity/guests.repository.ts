import { and, asc, eq, exists, gt, gte, inArray, isNull, lt, not, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { account, session, user } from '#server/db/tables'

/** The name an emptied guest keeps (Better Auth's own for a new guest, D156). */
export const EMPTIED_GUEST_NAME = 'Guest'

/**
 * A guest (D156) nobody has used since `cutoff`, not emptied yet: last changed before it (made, or
 * a name given at an order), and no session used since (Better Auth moves a session's
 * `updated_at` at most daily while it's used: `updateAge`). Orders are the orders feature's: the service
 * asks it. Also the write's guard, so a guest used between the read and the write stays.
 */
function idleGuest(db: Db, cutoff: Date): SQL {
  return and(
    eq(user.isAnonymous, true),
    isNull(user.anonymizedAt),
    lt(user.updatedAt, cutoff),
    not(exists(db.select({ id: session.id }).from(session).where(and(eq(session.userId, user.id), gte(session.updatedAt, cutoff))))),
  )!
}

export interface GuestCursor {
  updatedAt: Date
  id: string
}

/**
 * Across cafes (a guest is a person's, D156): the next idle guests after `after`, oldest change
 * first. Scans `user` (no index serves `is_anonymous`): one daily job, bounded by its pages.
 */
export function idleGuests(db: Db, cutoff: Date, after: GuestCursor | null, limit: number): Promise<GuestCursor[]> {
  const next = after ? or(gt(user.updatedAt, after.updatedAt), and(eq(user.updatedAt, after.updatedAt), gt(user.id, after.id))) : undefined
  return db.select({ id: user.id, updatedAt: user.updatedAt }).from(user)
    .where(and(idleGuest(db, cutoff), next))
    .orderBy(asc(user.updatedAt), asc(user.id))
    .limit(limit)
}

/**
 * Empties these guests (at most `IDS_PER_STATEMENT`), each only if still idle: the name becomes
 * "Guest" (orders read the customer's name from the account), `anonymized_at` is set, and its
 * sessions (address, browser) and any sign-in go, so it can never be used again. The row stays:
 * orders reference it (`restrict`). The update returns the ids it emptied; the deletes follow it.
 */
export function emptyGuestsStatements(db: Db, ids: string[], cutoff: Date, now: Date): [Statement, ...Statement[]] {
  const emptiedNow = db.select({ id: user.id }).from(user).where(and(inArray(user.id, ids), eq(user.anonymizedAt, now)))
  return [
    db.update(user).set({ name: EMPTIED_GUEST_NAME, anonymizedAt: now, updatedAt: now })
      .where(and(inArray(user.id, ids), idleGuest(db, cutoff)))
      .returning({ id: user.id }),
    db.delete(session).where(inArray(session.userId, emptiedNow)),
    db.delete(account).where(inArray(account.userId, emptiedNow)),
  ]
}
