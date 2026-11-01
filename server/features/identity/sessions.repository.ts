import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { Db } from '#server/utils/batch'
import { session } from '#server/db/tables'

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
  return db.update(session).set({ confirmedAt: at, confirmFailures: 0 }).where(and(eq(session.id, sessionId), eq(session.userId, userId)))
}

/** A wrong password: one more on this session's count, in SQL so two at once both count (D246). */
export function countConfirmFailureStatement(db: Db, userId: string, sessionId: string) {
  return db.update(session).set({ confirmFailures: sql`coalesce(${session.confirmFailures}, 0) + 1` }).where(and(eq(session.id, sessionId), eq(session.userId, userId)))
}

/** Ends one session (the account's own, by id). */
export async function deleteSession(db: Db, userId: string, sessionId: string): Promise<void> {
  await db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, userId)))
}
