import { and, desc, eq, gt } from 'drizzle-orm'
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

/** Ends one session (the account's own, by id). */
export async function deleteSession(db: Db, userId: string, sessionId: string): Promise<void> {
  await db.delete(session).where(and(eq(session.id, sessionId), eq(session.userId, userId)))
}
