import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { session, user } from '#server/db/tables'
import { createTestAuth, sessionHeaders, signIn } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { authorizePlatform, platformSession } from '#server/features/identity/identity.service'
import type { SessionUser } from '#server/features/identity/identity.types'

// Two-step sign-in (P1b, D188) with Better Auth's `twoFactor` plugin on a test database: setting it
// up, signing in with an authenticator code or a backup code, and the console requiring it.

let db: Db
let auth: TestAuth
const EMAIL = 'ops@example.com'
const PASSWORD = 'the super admin password'

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  auth = createTestAuth(db)
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Ops' } })
  await db.update(user).set({ role: 'superadmin' }).where(eq(user.email, EMAIL))
})

const userOf = async (headers: Headers) => (await auth.api.getSession({ headers }))?.user as SessionUser | undefined
/** The app's secret from the QR code's URI: base32 there, the raw string Better Auth keeps. */
function secretOf(totpURI: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...new URL(totpURI).searchParams.get('secret')!.replace(/=+$/, '')].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
  return String.fromCharCode(...bits.match(/.{8}/g)!.map(byte => Number.parseInt(byte, 2)))
}
const codeFor = async (secret: string) => (await auth.api.generateTOTP({ body: { secret } })).code

/** Starts setup with an authenticator app (TOTP): the QR code's URI and the backup codes. */
async function enable(headers: Headers, password = PASSWORD) {
  const result = await auth.api.enableTwoFactor({ headers, body: { password, method: 'totp' } })
  if (result.method !== 'totp') throw new Error('expected TOTP')
  return result
}

/** Sets up 2FA from a signed-in session; returns the new session's headers, the secret and the backup codes. */
async function setUp(headers: Headers) {
  const { totpURI, backupCodes } = await enable(headers)
  const secret = secretOf(totpURI)
  const { headers: swapped } = await auth.api.verifyTOTP({ headers, body: { code: await codeFor(secret) }, returnHeaders: true })
  return { headers: sessionHeaders(swapped), secret, backupCodes }
}

/** The password step of a sign-in: no session yet, a challenge cookie to send with the code. */
async function passwordStep() {
  const { headers, response } = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD }, returnHeaders: true })
  return { response: response as { twoFactorRedirect?: boolean }, challenge: sessionHeaders(headers) }
}

describe('setting up two-step sign-in', () => {
  it('needs the password and a code from the app before it counts; the console then opens', async () => {
    const headers = await signIn(auth, EMAIL, PASSWORD)
    await expectApiError(async () => authorizePlatform(await userOf(headers), { tenant: ['read'] }), 403, 'TWO_FACTOR_REQUIRED')
    expect(platformSession(await userOf(headers))).toMatchObject({ twoFactorEnabled: false })

    await expect(enable(headers, 'not the password')).rejects.toThrow()
    const { totpURI, backupCodes } = await enable(headers)
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/NUK%20Platform:/)
    expect(backupCodes).toHaveLength(10)
    // Not on until a code from the app proves it was added there.
    expect((await userOf(headers))?.twoFactorEnabled).toBe(false)
    await expect(auth.api.verifyTOTP({ headers, body: { code: '000000' } })).rejects.toThrow()

    const { headers: swapped } = await auth.api.verifyTOTP({ headers, body: { code: await codeFor(secretOf(totpURI)) }, returnHeaders: true })
    const after = sessionHeaders(swapped)
    expect(authorizePlatform(await userOf(after), { tenant: ['read'] })).toMatchObject({ userId: expect.any(String) })
  })

  it('signs out every other device: a session from the password alone doesn\'t count as two-step', async () => {
    const elsewhere = await signIn(auth, EMAIL, PASSWORD)
    const here = await signIn(auth, EMAIL, PASSWORD)
    const { headers } = await setUp(here)
    expect(await userOf(elsewhere)).toBeUndefined()
    expect(await userOf(headers)).toMatchObject({ twoFactorEnabled: true })
    const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL))
    expect(await db.select().from(session).where(eq(session.userId, account!.id))).toHaveLength(1)
  })
})

describe('signing in with two-step sign-in', () => {
  it('asks for a code after the password: no session until then, a session after a right code', async () => {
    const { secret } = await setUp(await signIn(auth, EMAIL, PASSWORD))
    const { response, challenge } = await passwordStep()
    expect(response.twoFactorRedirect).toBe(true)
    expect(await userOf(challenge)).toBeUndefined()

    await expect(auth.api.verifyTOTP({ headers: challenge, body: { code: '000000' } })).rejects.toThrow()
    const { headers } = await auth.api.verifyTOTP({ headers: challenge, body: { code: await codeFor(secret) }, returnHeaders: true })
    expect(authorizePlatform(await userOf(sessionHeaders(headers)), { account: ['read'] })).toMatchObject({ userId: expect.any(String) })
  })

  it('takes a backup code once', async () => {
    const { backupCodes } = await setUp(await signIn(auth, EMAIL, PASSWORD))
    const first = await passwordStep()
    const { headers } = await auth.api.verifyBackupCode({ headers: first.challenge, body: { code: backupCodes[0]! }, returnHeaders: true })
    expect(await userOf(sessionHeaders(headers))).toMatchObject({ twoFactorEnabled: true })

    const second = await passwordStep()
    await expect(auth.api.verifyBackupCode({ headers: second.challenge, body: { code: backupCodes[0]! } })).rejects.toThrow()
  })

  it('a code without the password step first is refused', async () => {
    const { secret } = await setUp(await signIn(auth, EMAIL, PASSWORD))
    await expect(auth.api.verifyTOTP({ headers: new Headers(), body: { code: await codeFor(secret) } })).rejects.toThrow()
  })
})
