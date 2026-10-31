import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { member, session, user } from '#server/db/tables'
import { newId } from '#server/utils/ids'
import { createTestAuth, sessionHeaders, signIn } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { addBranchStaff, createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { adminSession, authorizePlatform, counterSession, platformSession } from '#server/features/identity/identity.service'
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
async function setUp(headers: Headers, password = PASSWORD) {
  const { totpURI, backupCodes } = await enable(headers, password)
  const secret = secretOf(totpURI)
  const { headers: swapped } = await auth.api.verifyTOTP({ headers, body: { code: await codeFor(secret) }, returnHeaders: true })
  return { headers: sessionHeaders(swapped), secret, backupCodes }
}

/** The password step of a sign-in: no session yet, a challenge cookie to send with the code. */
async function passwordStep(email = EMAIL, password = PASSWORD) {
  const { headers, response } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
  return { response: response as { twoFactorRedirect?: boolean }, challenge: sessionHeaders(headers) }
}

describe('setting up two-step sign-in', () => {
  it('needs the password and a code from the app before it counts; the console then opens', async () => {
    const headers = await signIn(auth, EMAIL, PASSWORD)
    await expectApiError(async () => authorizePlatform(await userOf(headers), { tenant: ['read'] }), 403, 'TWO_FACTOR_REQUIRED')
    expect(platformSession(await userOf(headers))).toMatchObject({ twoFactorEnabled: false })

    await expect(enable(headers, 'not the password')).rejects.toThrow()
    const { totpURI, backupCodes } = await enable(headers)
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/Angder:.*issuer=Angder/)
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

describe('owners and staff (account security page, D242)', () => {
  const OWNER = 'owner@example.com'
  const CASHIER = 'cashier@example.com'
  const OTHER_PASSWORD = 'a cafe account password'

  beforeEach(async () => {
    const owner = await auth.api.signUpEmail({ body: { email: OWNER, password: OTHER_PASSWORD, name: 'Owner' } })
    await db.insert(member).values({ id: newId(), organizationId: TEST_TENANT, userId: owner.user.id, role: 'owner', createdAt: new Date() })
    const cashier = await auth.api.signUpEmail({ body: { email: CASHIER, password: OTHER_PASSWORD, name: 'Cashier' } })
    const branchId = newId()
    await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
    await addBranchStaff(db, branchId, cashier.user.id, 'staff')
  })

  it('an owner turns it on: the admin session says so, and the next sign-in asks for a code', async () => {
    const before = await signIn(auth, OWNER, OTHER_PASSWORD)
    expect((await adminSession(db, await userOf(before), TEST_TENANT)).twoFactorEnabled).toBe(false)
    const { headers, secret } = await setUp(before, OTHER_PASSWORD)
    expect((await adminSession(db, await userOf(headers), TEST_TENANT)).twoFactorEnabled).toBe(true)

    const { response, challenge } = await passwordStep(OWNER, OTHER_PASSWORD)
    expect(response.twoFactorRedirect).toBe(true)
    expect(await userOf(challenge)).toBeUndefined()
    const { headers: signedIn } = await auth.api.verifyTOTP({ headers: challenge, body: { code: await codeFor(secret) }, returnHeaders: true })
    expect(await adminSession(db, await userOf(sessionHeaders(signedIn)), TEST_TENANT)).toMatchObject({ role: 'admin', twoFactorEnabled: true })
  })

  it('a cashier turns it on, and off again with the password: then the password alone signs in', async () => {
    const { headers } = await setUp(await signIn(auth, CASHIER, OTHER_PASSWORD), OTHER_PASSWORD)
    expect((await counterSession(db, await userOf(headers), TEST_TENANT)).twoFactorEnabled).toBe(true)

    await expect(auth.api.disableTwoFactor({ headers, body: { password: 'not the password' } })).rejects.toThrow()
    expect((await userOf(headers))?.twoFactorEnabled).toBe(true)
    // Turning it off swaps this browser's session for a new one.
    const { headers: swapped } = await auth.api.disableTwoFactor({ headers, body: { password: OTHER_PASSWORD }, returnHeaders: true })
    expect((await counterSession(db, await userOf(sessionHeaders(swapped)), TEST_TENANT)).twoFactorEnabled).toBe(false)
    expect((await passwordStep(CASHIER, OTHER_PASSWORD)).response.twoFactorRedirect).toBeUndefined()
  })

  it('a super admin can\'t turn it off: the console requires it (D188)', async () => {
    const { headers } = await setUp(await signIn(auth, EMAIL, PASSWORD))
    // Better Auth's own error: the code is on its body.
    await expect(auth.api.disableTwoFactor({ headers, body: { password: PASSWORD } })).rejects.toMatchObject({ statusCode: 403, body: { code: 'TWO_FACTOR_REQUIRED' } })
    expect((await userOf(headers))?.twoFactorEnabled).toBe(true)
  })
})
