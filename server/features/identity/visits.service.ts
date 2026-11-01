import type { Db } from '#server/utils/batch'
import * as repo from './visits.repository'

/**
 * "Last active here" on the owner's Staff page (account security step 4, D248): when a person last
 * opened **this cafe's** admin or counter, never their sign-in elsewhere on the platform (another
 * cafe, the customer site).
 */

/** A visit is recorded at most this often per person and cafe: the Staff page shows it to the hour. */
export const VISIT_INTERVAL_MS = 60 * 60_000

/**
 * Called by the admin's and the counter's `/me` once they've let the person in (never on a support
 * visit, never refused). Best effort: the caller logs a failure and still answers.
 */
export async function recordWorkspaceVisit(db: Db, tenantId: string, userId: string, now = new Date()): Promise<void> {
  await db.batch([repo.recordVisitStatement(db, tenantId, userId, now, new Date(now.getTime() - VISIT_INTERVAL_MS))])
}

/** Last visits of these people in this cafe, by id. */
export const lastWorkspaceVisits = repo.lastVisitsOf
