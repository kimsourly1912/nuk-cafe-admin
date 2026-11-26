import { and, desc, eq, exists, gt, sql } from 'drizzle-orm'
import type { Db } from '#server/utils/batch'
import { member, session } from '#server/db/tables'

// --- Row types ---

export interface SessionRow {
  id: string
  userAgent: string | null
  createdAt: Date
}

// --- Queries ---

/** The account's sessions that haven't expired, newest sign-in first. */
export function listActiveSessions(db: Db, userId: string, now: Date): Promise<SessionRow[]> {
  return db.select({ id: session.id, userAgent: session.userAgent, createdAt: session.createdAt })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
    .orderBy(desc(session.createdAt), desc(session.id))
}

/** This session's password confirmation (D246); `undefined`: not the account's live session. */
export async function sessionConfirmation(db: Db, userId: string, sessionId: string): Promise<{ confirmedAt: Date | null, confirmFailures: number | null } | undefined> {
  const [row] = await db.select({ confirmedAt: session.confirmedAt, confirmFailures: session.confirmFailures })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .limit(1)
  return row
}

/** A right password: confirmed now, the wrong-password count back to 0 (D246). */
export function markSessionConfirmedStatement(db: Db, userId: string, sessionId: string, at: Date) {
  return db.update(session).set({ confirmedAt: at, confirmFailures: 0 }).where(and(eq(session.id, sessionId), eq(session.userId, userId), gt(session.expiresAt, at)))
}

/** Reserve before checking a password: concurrent requests cannot all use the same remaining try. */
export function reserveConfirmationStatement(db: Db, userId: string, sessionId: string, at: Date, max: number) {
  return db.update(session).set({ confirmFailures: sql`coalesce(${session.confirmFailures}, 0) + 1` }).where(and(
    eq(session.id, sessionId),
    eq(session.userId, userId),
    gt(session.expiresAt, at),
    sql`coalesce(${session.confirmFailures}, 0) < ${max}`,
  ))
}

/** Revoke at the reserved-attempt limit in the same batch as the failed-check audit. */
export function endConfirmationSessionStatement(db: Db, userId: string, sessionId: string, max: number) {
  return db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, userId), sql`coalesce(${session.confirmFailures}, 0) >= ${max}`)).returning({ id: session.id })
}

/** Owns at least one cafe (an admin of it): who may choose Keep me signed in (D286). */
export async function ownsACafe(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: member.id }).from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
    .limit(1)
  return row !== undefined
}

/**
 * This session chose Keep me signed in **and** its account still owns a cafe (D286), in one read.
 * Asked only for a workspace session past its first day, so most requests never make it.
 */
export async function isKeptOwnerSession(db: Db, userId: string, sessionId: string): Promise<boolean> {
  const [row] = await db.select({ id: session.id }).from(session)
    .where(and(
      eq(session.id, sessionId),
      eq(session.userId, userId),
      eq(session.keepSignedIn, true),
      exists(db.select({ id: member.id }).from(member).where(and(eq(member.userId, userId), eq(member.role, 'owner')))),
    ))
    .limit(1)
  return row !== undefined
}

/** Keep me signed in on this session (D286); nothing for an expired or another account's session. */
export function markSessionKeptStatement(db: Db, userId: string, sessionId: string, at: Date) {
  return db.update(session).set({ keepSignedIn: true }).where(and(eq(session.id, sessionId), eq(session.userId, userId), gt(session.expiresAt, at)))
}

/** Ends one session (the account's own, by id). */
export async function deleteSession(db: Db, userId: string, sessionId: string): Promise<void> {
  await db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, userId)))
}
