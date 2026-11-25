import type { AccountSession, SessionKept } from '#shared/contracts/account'
import type { Db } from '#server/utils/batch'
import { requireOneChange, tryGuardedBatch } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import { auditStatement } from '#server/features/platform'
import { keepSignedInNotAllowed, keepSignedInTooLate, sessionExpired, unauthenticated } from './identity.errors'
import { isSuperadmin } from './staff.rules'
import * as repo from './sessions.repository'
import type { SessionUser } from './identity.types'

/**
 * Session length by role (account security plan Q2, D243, D286). Customers keep Better Auth's 90
 * days, renewed while used (D286). A workspace (a cafe's admin and counter, the platform console)
 * takes a session for **1 day from sign-in**, never renewed: a tablet or phone left signed in is out
 * by the next day. Measured from the session's own `createdAt`, so it holds however the account's
 * roles change after sign-in (an account given access mid-session signs in again).
 */
export const WORKSPACE_SESSION_MS = 24 * 60 * 60 * 1000

/**
 * Keep me signed in (D286): an owner's own phone or computer. A session that chose it at sign-in
 * lasts **30 days from sign-in** in the workspaces while its account owns a cafe; still never
 * renewed. Super admins never: their accounts reach every cafe.
 */
export const KEPT_WORKSPACE_SESSION_MS = 30 * WORKSPACE_SESSION_MS

/**
 * How soon after sign-in Keep me signed in can be chosen (D286). The app asks right after the
 * sign-in (password, two-step code or Google) succeeds; later, a session someone else got hold of
 * can't make itself last longer.
 */
export const KEEP_SIGNED_IN_WINDOW_MS = 5 * 60 * 1000

/** The parts of Better Auth's session the check reads. */
export interface SessionStamp {
  id: string
  createdAt: Date | string
}

/** Milliseconds since sign-in; `NaN` for an unreadable time (counted as ended). */
const ageOf = (stamp: SessionStamp, now: Date) => now.getTime() - new Date(stamp.createdAt).getTime()

/**
 * A workspace's session check: older than a day from sign-in (30 days for a kept owner session,
 * D286), the session is deleted (signed out on this device) and the request is 401
 * `SESSION_EXPIRED`. No session: nothing to check (the route's own access check answers 401). Only a
 * session past its first day reads the database.
 */
export async function requireWorkspaceSession(db: Db, user: SessionUser | null | undefined, stamp: SessionStamp | undefined, now = new Date()): Promise<void> {
  if (!user || !stamp) return
  const age = ageOf(stamp, now)
  if (age < WORKSPACE_SESSION_MS) return
  if (age < KEPT_WORKSPACE_SESSION_MS && !isSuperadmin(user.role) && await repo.isKeptOwnerSession(db, user.id, stamp.id)) return
  await repo.deleteSession(db, user.id, stamp.id)
  throw sessionExpired()
}

/** Audit action: this session chose Keep me signed in (D286). */
const KEEP_SIGNED_IN_ACTION = 'identity.session.keep'

export interface KeepSignedInOptions {
  requestId?: string
  now?: Date
}

/**
 * `POST /api/me/keep-signed-in` (D286): this session lasts 30 days from sign-in in the workspaces.
 * Only within `KEEP_SIGNED_IN_WINDOW_MS` of sign-in (403 `KEEP_SIGNED_IN_TOO_LATE`), and only for an
 * account that owns a cafe and isn't a super admin (403 `KEEP_SIGNED_IN_NOT_ALLOWED`). Audited in
 * the same batch; asking again is harmless.
 */
export async function keepSignedIn(db: Db, user: SessionUser | null | undefined, stamp: SessionStamp | undefined, options: KeepSignedInOptions = {}): Promise<SessionKept> {
  const { requestId, now = new Date() } = options
  if (!user || !stamp) throw unauthenticated()
  const age = ageOf(stamp, now)
  if (!(age < KEEP_SIGNED_IN_WINDOW_MS)) throw keepSignedInTooLate()
  if (isSuperadmin(user.role) || !await repo.ownsACafe(db, user.id)) throw keepSignedInNotAllowed()
  const marked = await tryGuardedBatch(db, [
    repo.markSessionKeptStatement(db, user.id, stamp.id, now),
    requireOneChange(db),
    auditStatement(db, { userId: user.id, tenantId: null, requestId }, { action: KEEP_SIGNED_IN_ACTION, targetType: 'user', targetId: user.id }),
  ])
  if (!marked) throw unauthenticated()
  return { keptUntil: toIso(new Date(new Date(stamp.createdAt).getTime() + KEPT_WORKSPACE_SESSION_MS)) }
}

/** Where the account is signed in (Your devices). Not signed in: 401. */
export async function listAccountSessions(db: Db, user: SessionUser | null | undefined, currentId: string | undefined, now = new Date()): Promise<AccountSession[]> {
  if (!user) throw unauthenticated()
  const rows = await repo.listActiveSessions(db, user.id, now)
  return rows.map(row => ({ id: row.id, device: deviceLabel(row.userAgent), signedInAt: toIso(row.createdAt), current: row.id === currentId }))
}

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

/**
 * A device as a person recognizes it, from its user agent: "Chrome on Android". Only the common
 * browsers and systems; anything else is "Unknown device". The user agent is the browser's own
 * claim: a label, never a check.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1]
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? 'Unknown device'
}
