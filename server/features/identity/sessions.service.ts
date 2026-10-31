import type { AccountSession } from '#shared/contracts/account'
import type { Db } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import { sessionExpired, unauthenticated } from './identity.errors'
import * as repo from './sessions.repository'
import type { SessionUser } from './identity.types'

/**
 * Session length by role (account security plan Q2, D243). Customers keep Better Auth's 7 days,
 * renewed while used (D45). A workspace (a cafe's admin and counter, the platform console) takes a
 * session for **1 day from sign-in**, never renewed: a tablet or phone left signed in is out by the
 * next day. Measured from the session's own `createdAt`, so it holds however the account's roles
 * change after sign-in (an account given access mid-session signs in again).
 */
export const WORKSPACE_SESSION_MS = 24 * 60 * 60 * 1000

/** The parts of Better Auth's session the check reads. */
export interface SessionStamp {
  id: string
  createdAt: Date | string
}

/**
 * A workspace's session check: older than a day from sign-in, the session is deleted (signed out
 * on this device) and the request is 401 `SESSION_EXPIRED`. No session: nothing to check (the
 * route's own access check answers 401).
 */
export async function requireWorkspaceSession(db: Db, user: SessionUser | null | undefined, stamp: SessionStamp | undefined, now = new Date()): Promise<void> {
  if (!user || !stamp) return
  if (now.getTime() - new Date(stamp.createdAt).getTime() < WORKSPACE_SESSION_MS) return
  await repo.deleteSession(db, user.id, stamp.id)
  throw sessionExpired()
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
