import { CONFIRMATION_MS } from '#shared/contracts/account'
import type { ConfirmIdentityInput, IdentityConfirmed } from '#shared/contracts/account'
import type { Db } from '#server/utils/batch'
import { requireOneChange, tryGuardedBatch } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import { auditStatement } from '#server/features/platform'
import { confirmationRequired, tooManyConfirmations, unauthenticated, wrongPassword } from './identity.errors'
import * as repo from './sessions.repository'
import type { SessionUser } from './identity.types'

/**
 * Re-confirming before dangerous changes (account security step 3, D246), like GitHub's sudo mode.
 * A stolen session (a phone left unlocked, a copied cookie) can read the workspace, but it can't
 * change where the cafe's payments go, make someone an admin or change a cafe's owners without the
 * account's password. A right password lasts `CONFIRMATION_MS` for **this session only**: it's kept
 * on the session row, so signing out ends it and another device's confirmation never counts.
 */

/** Wrong passwords a session may give in a row; the next check ends the session. */
export const MAX_CONFIRM_FAILURES = 5

/** Audit action of a wrong password: someone with this session doesn't know the password. */
const CONFIRM_FAILED_ACTION = 'identity.confirm.failed'

export interface ConfirmOptions {
  /** Better Auth's check of the password against this session (`verifyPassword`). */
  verifyPassword: (password: string) => Promise<boolean>
  requestId?: string
  now?: Date
}

/**
 * `POST /api/me/confirm`: the account's password confirms this session. Wrong: 400 beside the field,
 * counted and audited; at `MAX_CONFIRM_FAILURES` the session is deleted (401): a stolen session
 * gets a few guesses, not unlimited ones. Counted per session, so a stranger's guesses on a stolen
 * session never sign out the owner's other devices.
 */
export async function confirmIdentity(db: Db, user: SessionUser | null | undefined, sessionId: string | undefined, input: ConfirmIdentityInput, options: ConfirmOptions): Promise<IdentityConfirmed> {
  const { verifyPassword, requestId, now = new Date() } = options
  if (!user || !sessionId) throw unauthenticated()
  const state = await repo.sessionConfirmation(db, user.id, sessionId)
  if (!state) throw unauthenticated()
  if ((state.confirmFailures ?? 0) >= MAX_CONFIRM_FAILURES) return endSession(db, user.id, sessionId)
  // In-flight or interrupted checks consume a slot until a successful confirmation resets it.
  if (!await tryGuardedBatch(db, [repo.reserveConfirmationStatement(db, user.id, sessionId, now, MAX_CONFIRM_FAILURES), requireOneChange(db)])) return endSession(db, user.id, sessionId)

  if (!(await verifyPassword(input.password))) {
    const [, ended] = await db.batch([
      auditStatement(db, { userId: user.id, tenantId: null, requestId }, { action: CONFIRM_FAILED_ACTION, targetType: 'user', targetId: user.id }),
      repo.endConfirmationSessionStatement(db, user.id, sessionId, MAX_CONFIRM_FAILURES),
    ])
    if (ended.length) throw tooManyConfirmations()
    throw wrongPassword()
  }

  const confirmedAt = options.now ?? new Date()
  if (!await tryGuardedBatch(db, [repo.markSessionConfirmedStatement(db, user.id, sessionId, confirmedAt), requireOneChange(db)])) throw unauthenticated()
  return { confirmedUntil: toIso(new Date(confirmedAt.getTime() + CONFIRMATION_MS)) }
}

async function endSession(db: Db, userId: string, sessionId: string): Promise<never> {
  await repo.deleteSession(db, userId, sessionId)
  throw tooManyConfirmations()
}

/**
 * The check a dangerous route makes after its permission check (`requireConfirmation`): this session
 * confirmed its password less than `CONFIRMATION_MS` ago, or 403 `CONFIRMATION_REQUIRED`, which the
 * app answers with "Confirm it's you" and the same request again.
 */
export async function requireRecentConfirmation(db: Db, user: SessionUser | null | undefined, sessionId: string | undefined, now = new Date()): Promise<void> {
  if (!user || !sessionId) throw unauthenticated()
  const state = await repo.sessionConfirmation(db, user.id, sessionId)
  if (!state) throw unauthenticated()
  const at = state.confirmedAt?.getTime()
  if (at === undefined || Number.isNaN(at) || now.getTime() - at >= CONFIRMATION_MS || at > now.getTime()) throw confirmationRequired()
}
