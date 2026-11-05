import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { CONFIRMATION_MS } from '#shared/contracts/account'
import type { Db } from '#server/utils/batch'
import { auditEvents, session } from '#server/db/tables'
import { createTestAuth, sessionHeaders } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { confirmIdentity, MAX_CONFIRM_FAILURES, requireRecentConfirmation } from '#server/features/identity/confirmation.service'
import type { SessionUser } from '#server/features/identity/identity.types'

// Re-confirming before dangerous changes (account security step 3, D246), against Better Auth's
// own password check on a test database.

let db: Db
let auth: TestAuth
const PASSWORD = 'a long enough password'

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  auth = createTestAuth(db)
  await auth.api.signUpEmail({ body: { email: 'dara@example.com', password: PASSWORD, name: 'Dara' } })
  await auth.api.signUpEmail({ body: { email: 'other@example.com', password: PASSWORD, name: 'Other' } })
  await db.delete(session)
})

/** A signed-in device: its session, and the password check Better Auth makes for it. */
async function signIn(email = 'dara@example.com') {
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
  const cookies = sessionHeaders(headers)
  const signedIn = (await auth.api.getSession({ headers: cookies }))!
  const verifyPassword = (password: string) => auth.api.verifyPassword({ headers: cookies, body: { password } }).then(() => true, () => false)
  return { user: signedIn.user as SessionUser, sessionId: signedIn.session.id, verifyPassword, cookies }
}

const failuresOf = async (sessionId: string) => (await db.select({ n: session.confirmFailures }).from(session).where(eq(session.id, sessionId)))[0]?.n

describe('a dangerous change needs this session\'s password in the last 15 minutes', () => {
  it('refuses before confirming, allows after, and asks again at 15 minutes', async () => {
    const device = await signIn()
    await expectApiError(() => requireRecentConfirmation(db, device.user, device.sessionId), 403, 'CONFIRMATION_REQUIRED')

    const at = new Date()
    const confirmed = await confirmIdentity(db, device.user, device.sessionId, { password: PASSWORD }, { verifyPassword: device.verifyPassword, now: at })
    expect(confirmed.confirmedUntil).toBe(new Date(at.getTime() + CONFIRMATION_MS).toISOString())

    await requireRecentConfirmation(db, device.user, device.sessionId, new Date(at.getTime() + CONFIRMATION_MS - 1000))
    await expectApiError(() => requireRecentConfirmation(db, device.user, device.sessionId, new Date(at.getTime() + CONFIRMATION_MS)), 403, 'CONFIRMATION_REQUIRED')
  })

  it('counts for this session only: not the account\'s other devices, not another account', async () => {
    const phone = await signIn()
    const laptop = await signIn()
    const other = await signIn('other@example.com')
    await confirmIdentity(db, phone.user, phone.sessionId, { password: PASSWORD }, { verifyPassword: phone.verifyPassword })

    await requireRecentConfirmation(db, phone.user, phone.sessionId)
    await expectApiError(() => requireRecentConfirmation(db, laptop.user, laptop.sessionId), 403, 'CONFIRMATION_REQUIRED')
    // Another account naming this session's id isn't its session.
    await expectApiError(() => requireRecentConfirmation(db, other.user, phone.sessionId), 401, 'UNAUTHENTICATED')
  })

  it('ends with the session: signed out, it\'s gone', async () => {
    const device = await signIn()
    await confirmIdentity(db, device.user, device.sessionId, { password: PASSWORD }, { verifyPassword: device.verifyPassword })
    await auth.api.signOut({ headers: device.cookies })
    await expectApiError(() => requireRecentConfirmation(db, device.user, device.sessionId), 401, 'UNAUTHENTICATED')
  })

  it('refuses without a session', async () => {
    const device = await signIn()
    await expectApiError(() => requireRecentConfirmation(db, null, device.sessionId), 401, 'UNAUTHENTICATED')
    await expectApiError(() => requireRecentConfirmation(db, device.user, undefined), 401, 'UNAUTHENTICATED')
    await expectApiError(() => confirmIdentity(db, null, device.sessionId, { password: PASSWORD }, { verifyPassword: device.verifyPassword }), 401, 'UNAUTHENTICATED')
  })
})

describe('wrong passwords', () => {
  it('are refused beside the field, counted and audited; a right one resets the count', async () => {
    const device = await signIn()
    const wrong = () => confirmIdentity(db, device.user, device.sessionId, { password: 'not it' }, { verifyPassword: device.verifyPassword })

    await expectApiError(wrong, 400, 'WRONG_PASSWORD')
    await expectApiError(wrong, 400, 'WRONG_PASSWORD')
    expect(await failuresOf(device.sessionId)).toBe(2)
    await expectApiError(() => requireRecentConfirmation(db, device.user, device.sessionId), 403, 'CONFIRMATION_REQUIRED')
    const audited = await db.select({ action: auditEvents.action, actorId: auditEvents.actorId, tenantId: auditEvents.tenantId }).from(auditEvents)
    expect(audited).toEqual([
      { action: 'identity.confirm.failed', actorId: device.user.id, tenantId: null },
      { action: 'identity.confirm.failed', actorId: device.user.id, tenantId: null },
    ])

    await confirmIdentity(db, device.user, device.sessionId, { password: PASSWORD }, { verifyPassword: device.verifyPassword })
    expect(await failuresOf(device.sessionId)).toBe(0)
  })

  it(`end the session at ${MAX_CONFIRM_FAILURES} in a row, so a stolen session can't keep guessing; other devices stay`, async () => {
    const stolen = await signIn()
    const owners = await signIn()
    const wrong = () => confirmIdentity(db, stolen.user, stolen.sessionId, { password: 'guess' }, { verifyPassword: stolen.verifyPassword })
    for (let i = 1; i < MAX_CONFIRM_FAILURES; i++) await expectApiError(wrong, 400, 'WRONG_PASSWORD')
    await expectApiError(wrong, 401, 'SESSION_EXPIRED')

    expect(await auth.api.getSession({ headers: stolen.cookies })).toBeNull()
    // Even the right password is too late now.
    await expectApiError(() => confirmIdentity(db, stolen.user, stolen.sessionId, { password: PASSWORD }, { verifyPassword: stolen.verifyPassword }), 401, 'UNAUTHENTICATED')
    // The owner's other device isn't signed out by a stranger's guesses.
    expect((await auth.api.getSession({ headers: owners.cookies }))?.session.id).toBe(owners.sessionId)
    await confirmIdentity(db, owners.user, owners.sessionId, { password: PASSWORD }, { verifyPassword: owners.verifyPassword })
  })

  it('a session already at the limit is ended before its password is even checked', async () => {
    const device = await signIn()
    await db.update(session).set({ confirmFailures: MAX_CONFIRM_FAILURES }).where(eq(session.id, device.sessionId))
    let checked = false
    const verifyPassword = async () => {
      checked = true
      return true
    }
    await expectApiError(() => confirmIdentity(db, device.user, device.sessionId, { password: PASSWORD }, { verifyPassword }), 401, 'SESSION_EXPIRED')
    expect(checked).toBe(false)
  })
})

describe('parallel confirmation attempts', () => {
  it('reserves at most five checks and ends only the attacked device', async () => {
    const device = await signIn()
    const other = await signIn()
    let checked = 0
    const attempts = Array.from({ length: 12 }, () => confirmIdentity(db, device.user, device.sessionId, { password: 'wrong' }, {
      verifyPassword: async () => {
        checked++
        return false
      },
    }))
    const results = await Promise.allSettled(attempts)
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    expect(checked).toBeGreaterThan(0)
    expect(checked).toBeLessThanOrEqual(MAX_CONFIRM_FAILURES)
    expect(await failuresOf(device.sessionId)).toBeUndefined()
    expect((await auth.api.getSession({ headers: other.cookies }))?.session.id).toBe(other.sessionId)
  })

  it('does not report confirmation after the session was revoked during the password check', async () => {
    const device = await signIn()
    await expectApiError(() => confirmIdentity(db, device.user, device.sessionId, { password: PASSWORD }, {
      verifyPassword: async () => {
        await db.delete(session).where(eq(session.id, device.sessionId))
        return true
      },
    }), 401, 'UNAUTHENTICATED')
  })

  it('does not confirm a session that expires during verification', async () => {
    const device = await signIn()
    await expectApiError(() => confirmIdentity(db, device.user, device.sessionId, { password: PASSWORD }, {
      verifyPassword: async () => {
        await db.update(session).set({ expiresAt: new Date() }).where(eq(session.id, device.sessionId))
        await new Promise(resolve => setTimeout(resolve, 10))
        return true
      },
    }), 401, 'UNAUTHENTICATED')
  })
})
