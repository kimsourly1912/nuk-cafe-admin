import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '#server/utils/batch'
import { session } from '#server/db/tables'
import { createTestAuth, sessionHeaders } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { deviceLabel, listAccountSessions, requireWorkspaceSession, WORKSPACE_SESSION_MS } from '#server/features/identity/sessions.service'
import type { SessionUser } from '#server/features/identity/identity.types'

// Session length by role and Your devices (D243), against Better Auth on a test database.

let db: Db
let auth: TestAuth
const PASSWORD = 'a long enough password'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  auth = createTestAuth(db)
  await auth.api.signUpEmail({ body: { email: 'dara@example.com', password: PASSWORD, name: 'Dara' } })
  await auth.api.signUpEmail({ body: { email: 'other@example.com', password: PASSWORD, name: 'Other' } })
  // Sign-up signs in too: each test makes its own sessions.
  await db.delete(session)
})

afterEach(() => {
  vi.useRealTimers()
})

async function signInFrom(userAgent: string, email = 'dara@example.com') {
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, headers: new Headers({ 'user-agent': userAgent }), returnHeaders: true })
  return sessionHeaders(headers)
}
const sessionOf = async (headers: Headers) => (await auth.api.getSession({ headers }))!

describe('a workspace session ends a day after sign-in', () => {
  it('Better Auth keeps renewing the session; the workspace check ends it at a day, and deletes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const headers = await signInFrom(ANDROID)
    const signedIn = await sessionOf(headers)
    const check = (now: Date) => requireWorkspaceSession(db, signedIn.user as SessionUser, signedIn.session, now)

    vi.setSystemTime(Date.now() + WORKSPACE_SESSION_MS - 1000)
    await check(new Date())
    // As a customer's, it's still a session to Better Auth (7 days, renewed while used, D45).
    vi.setSystemTime(Date.now() + 2000)
    expect((await auth.api.getSession({ headers }))?.session.id).toBe(signedIn.session.id)
    await expectApiError(() => check(new Date()), 401, 'SESSION_EXPIRED')
    expect(await auth.api.getSession({ headers })).toBeNull()
  })

  it('a session without its sign-in time counts as ended', async () => {
    const headers = await signInFrom(ANDROID)
    const { user, session: stamp } = await sessionOf(headers)
    await expectApiError(() => requireWorkspaceSession(db, user as SessionUser, { id: stamp.id, createdAt: 'not a date' }), 401, 'SESSION_EXPIRED')
  })

  it('never deletes another account\'s session, whatever id it names', async () => {
    const theirs = await sessionOf(await signInFrom(ANDROID, 'other@example.com'))
    const mine = await sessionOf(await signInFrom(ANDROID))
    const old = new Date(Date.now() - 2 * WORKSPACE_SESSION_MS)
    await expectApiError(() => requireWorkspaceSession(db, mine.user as SessionUser, { id: theirs.session.id, createdAt: old }), 401, 'SESSION_EXPIRED')
    expect(await db.select().from(session).where(eq(session.id, theirs.session.id))).toHaveLength(1)
  })
})

describe('Your devices', () => {
  it('lists the account\'s own sessions, newest first, this one marked, with no token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await signInFrom(IPHONE)
    vi.setSystemTime(Date.now() + 60_000)
    const here = await sessionOf(await signInFrom(ANDROID))
    await signInFrom(ANDROID, 'other@example.com')

    const list = await listAccountSessions(db, here.user as SessionUser, here.session.id)
    expect(list.map(s => [s.device, s.current])).toEqual([['Chrome on Android', true], ['Safari on iPhone', false]])
    expect(Object.keys(list[0]!).sort()).toEqual(['current', 'device', 'id', 'signedInAt'])
  })

  it('leaves out expired sessions; signed out is 401', async () => {
    const here = await sessionOf(await signInFrom(ANDROID))
    await signInFrom(IPHONE)
    await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.userAgent, IPHONE))
    expect((await listAccountSessions(db, here.user as SessionUser, here.session.id)).map(s => s.device)).toEqual(['Chrome on Android'])
    await expectApiError(() => listAccountSessions(db, null, undefined), 401, 'UNAUTHENTICATED')
  })

  it('names the common devices, and nothing it can\'t tell', () => {
    expect(deviceLabel(ANDROID)).toBe('Chrome on Android')
    expect(deviceLabel(IPHONE)).toBe('Safari on iPhone')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('Edge on Windows')
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('Firefox on Mac')
    expect(deviceLabel('curl/8.0')).toBe('Unknown device')
    expect(deviceLabel('')).toBe('Unknown device')
    expect(deviceLabel(null)).toBe('Unknown device')
  })
})
