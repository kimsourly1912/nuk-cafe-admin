import { eq } from 'drizzle-orm'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '#auth/schema'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { orders } from '#server/features/orders/orders.schema'
import { accountProviders } from '#server/features/identity/identity.providers'
import { identityAuthOptions } from '#server/features/identity/identity.auth'
import { createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { sessionHeaders, TEST_SITE as SITE } from '#server/tests/support/auth'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
const google = { enabled: true, clientId: 'test-client', clientSecret: 'test-secret' }
function createAuth() {
  const options = identityAuthOptions({ db, siteUrl: SITE, checkBreachedPasswords: false, google })
  return betterAuth({
    ...options,
    // Better Auth skips origin checks in NODE_ENV=test unless explicitly enabled.
    // Exercise production HTTP protections without changing process-wide test settings.
    advanced: { ...options.advanced, disableOriginCheck: false, disableCSRFCheck: false },
    baseURL: SITE,
    secret: 'google-test-secret-at-least-32-characters',
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
  })
}
type Auth = ReturnType<typeof createAuth>
let auth: Auth
let email: string
let verified: boolean

beforeEach(async () => {
  db = await createTestDb()
  auth = createAuth()
  email = 'google@example.com'
  verified = true
})

/** Only Google's network boundary is mocked. State, cookies, routes, hooks and DB are real. */
async function mockGoogle() {
  const provider = (await auth.$context).socialProviders.find(p => p.id === 'google')!
  vi.spyOn(provider, 'validateAuthorizationCode').mockResolvedValue({
    accessToken: 'test-access-token', refreshToken: 'test-refresh-token', idToken: 'test-id-token',
  })
  vi.spyOn(provider, 'getUserInfo').mockImplementation(async () => ({
    user: { name: 'Google Person', email, emailVerified: verified, image: '' },
    data: { sub: 'google-subject', email, email_verified: verified },
  }))
  return provider
}

async function start(headers = new Headers()) {
  headers.set('origin', SITE)
  const result = await auth.api.signInSocial({
    body: { provider: 'google', callbackURL: SITE + '/sign-in?google=1', errorCallbackURL: SITE + '/sign-in' },
    headers,
    returnHeaders: true,
  })
  return { authorization: new URL(result.response.url!), headers: sessionHeaders(result.headers) }
}

async function callback(started: Awaited<ReturnType<typeof start>>, params: Record<string, string> = {}) {
  const url = new URL(SITE + '/api/auth/callback/google')
  url.search = new URLSearchParams({ state: started.authorization.searchParams.get('state')!, code: 'test-code', ...params }).toString()
  return auth.handler(new Request(url, { headers: started.headers }))
}

async function login() {
  const response = await callback(await start())
  const session = await auth.api.getSession({ headers: sessionHeaders(response.headers) })
  return { response, session }
}

describe('Google accounts', () => {
  it('is off without the rollout flag or either credential', () => {
    for (const settings of [undefined, { ...google, enabled: false }, { ...google, clientId: '' }, { ...google, clientSecret: '' }]) {
      expect(identityAuthOptions({ db, google: settings }).socialProviders).toEqual({})
      expect(accountProviders(settings)).toEqual({ google: false })
    }
  })

  it('exposes only availability, never private provider settings', () => {
    expect(accountProviders(google)).toEqual({ google: true })
  })

  it('starts a state-bound Google redirect and rejects direct ID-token sign-in', async () => {
    const flow = await start()
    expect(flow.authorization.origin).toBe('https://accounts.google.com')
    expect(flow.authorization.searchParams.get('redirect_uri')).toBe(SITE + '/api/auth/callback/google')
    expect(flow.authorization.searchParams.get('state')).toBeTruthy()
    expect(flow.authorization.searchParams.get('prompt')).toBe('select_account')
    await expect(auth.api.signInSocial({ body: { provider: 'google', idToken: { token: 'forged' } } })).rejects.toMatchObject({ body: { code: 'ID_TOKEN_NOT_SUPPORTED' } })
  })

  it.each([
    ['callbackURL', 'INVALID_CALLBACK_URL'],
    ['errorCallbackURL', 'INVALID_ERROR_CALLBACK_URL'],
    ['newUserCallbackURL', 'INVALID_NEW_USER_CALLBACK_URL'],
  ])('rejects an external %s through the real HTTP handler', async (field, code) => {
    const external = await auth.handler(new Request(SITE + '/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'origin': SITE, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', [field]: 'https://evil.example' }),
    }))
    expect(external.status).toBe(403)
    expect(await external.json()).toMatchObject({ code })
    expect(external.headers.getSetCookie()).toHaveLength(0)
  })

  it('sends an OAuth failure without a usable state to the popup callback page', async () => {
    const started = await start()
    const forged = await callback(started, { state: 'forged-state' })
    expect(forged.headers.get('location')).toBe('/google-callback?error=state_mismatch')
    const missing = await auth.handler(new Request(SITE + '/api/auth/callback/google?error=access_denied'))
    expect(missing.headers.get('location')).toBe('/google-callback?error=state_not_found')
  })

  it('accepts a local HTTP callback and refuses an untrusted origin on a cookie-bearing request', async () => {
    for (const origin of [SITE, 'https://evil.example']) {
      const response = await auth.handler(new Request(SITE + '/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'origin': origin, 'content-type': 'application/json', 'cookie': 'browser=test' },
        body: JSON.stringify({ provider: 'google', callbackURL: SITE + '/sign-in?google=1' }),
      }))
      if (origin === SITE) {
        expect(response.status).toBe(200)
        expect(new URL((await response.json()).url).origin).toBe('https://accounts.google.com')
      }
      else {
        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({ code: 'INVALID_ORIGIN' })
        expect(response.headers.getSetCookie()).toHaveLength(0)
      }
    }
  })

  it('creates a verified customer, stores no Google bearer tokens, and reuses that account on return', async () => {
    await ensureTenant(db)
    await ensureTenant(db, 'other-cafe')
    await mockGoogle()
    const first = await login()
    expect(first.response.headers.get('location')).toBe(SITE + '/sign-in?google=1')
    expect(first.session?.user).toMatchObject({ email, emailVerified: true, role: 'customer', mustChangePassword: false })
    const second = await login()
    expect(second.session?.user.id).toBe(first.session?.user.id)
    expect(await db.select().from(authSchema.user)).toHaveLength(1)
    const [account] = await db.select().from(authSchema.account)
    expect(account).toMatchObject({ providerId: 'google', accessToken: null, refreshToken: null, idToken: null })
    expect(await db.select().from(authSchema.member)).toHaveLength(0)
    expect(await db.select().from(customerProfiles)).toHaveLength(0)
  })

  it('reuses a verified same-email password account without changing its identity or cafe access', async () => {
    await mockGoogle()
    const password = 'existing long password'
    const created = await auth.api.signUpEmail({ body: { email, name: 'Existing Person', password } })
    await db.update(authSchema.user).set({ emailVerified: true }).where(eq(authSchema.user.id, created.user.id))
    for (const tenantId of [TEST_TENANT, 'other-cafe']) {
      await ensureTenant(db, tenantId)
      await db.insert(authSchema.member).values({ id: newId(), organizationId: tenantId, userId: created.user.id, role: 'owner', createdAt: new Date() })
    }
    const memberships = await db.select().from(authSchema.member)
    const first = await login()
    expect(first.session?.user).toMatchObject({ id: created.user.id, name: 'Existing Person', email, emailVerified: true })
    expect((await login()).session?.user.id).toBe(created.user.id)
    expect((await auth.api.signInEmail({ body: { email, password } })).user.id).toBe(created.user.id)
    expect(await db.select().from(authSchema.user)).toHaveLength(1)
    expect(await db.select().from(authSchema.member)).toEqual(memberships)
    const accounts = await db.select().from(authSchema.account)
    expect(accounts.map(row => row.providerId).sort()).toEqual(['credential', 'google'])
    expect(accounts.find(row => row.providerId === 'google')).toMatchObject({ userId: created.user.id, accessToken: null, refreshToken: null, idToken: null })
  })

  it('does not attach Google to an unverified local email or issue a session', async () => {
    await mockGoogle()
    await auth.api.signUpEmail({ body: { email, name: 'Existing Person', password: 'existing long password' } })
    const result = await login()
    expect(result.session).toBeNull()
    expect(new URL(result.response.headers.get('location')!).searchParams.get('error')).toBe('account_not_linked')
    expect(await db.select().from(authSchema.account).where(eq(authSchema.account.providerId, 'google'))).toHaveLength(0)
    expect(await db.select().from(authSchema.user)).toHaveLength(1)
  })

  it.each([
    { mustChangePassword: true },
    { role: 'superadmin' },
    { banned: true, banExpires: new Date(Date.now() + 86_400_000) },
  ])('does not even link Google to a protected password account: %j', async (flags) => {
    await mockGoogle()
    const created = await auth.api.signUpEmail({ body: { email, name: 'Existing Person', password: 'existing long password' } })
    await db.update(authSchema.user).set({ emailVerified: true, ...flags }).where(eq(authSchema.user.id, created.user.id))
    await db.delete(authSchema.session).where(eq(authSchema.session.userId, created.user.id))
    expect((await login()).session).toBeNull()
    expect(await db.select().from(authSchema.account).where(eq(authSchema.account.providerId, 'google'))).toHaveLength(0)
    expect(await db.select().from(authSchema.session)).toHaveLength(0)
  })

  it.each([
    { localVerified: false, googleVerified: true, googleEmail: 'google@example.com' },
    { localVerified: true, googleVerified: false, googleEmail: 'google@example.com' },
    { localVerified: true, googleVerified: true, googleEmail: 'someone-else@example.com' },
  ])('refuses explicit linking unless both sides verified the same email: %j', async (settings) => {
    await mockGoogle()
    const created = await auth.api.signUpEmail({ body: { email, name: 'Existing Person', password: 'existing long password' }, returnHeaders: true })
    await db.update(authSchema.user).set({ emailVerified: settings.localVerified }).where(eq(authSchema.user.id, created.response.user.id))
    verified = settings.googleVerified
    email = settings.googleEmail
    const headers = sessionHeaders(created.headers)
    headers.set('origin', SITE)
    const flow = await auth.api.linkSocialAccount({ body: { provider: 'google', callbackURL: SITE + '/sign-in' }, headers, returnHeaders: true })
    const response = await callback({ authorization: new URL(flow.response.url!), headers: sessionHeaders(flow.headers) })
    expect(new URL(response.headers.get('location')!, SITE).searchParams.has('error')).toBe(true)
    expect(await db.select().from(authSchema.account).where(eq(authSchema.account.providerId, 'google'))).toHaveLength(0)
    expect(await db.select().from(authSchema.user)).toHaveLength(1)
  })

  it('lets a Google-only customer set a password through the existing reset-email flow', async () => {
    await mockGoogle()
    const first = await login()
    await auth.api.requestPasswordReset({ body: { email, redirectTo: SITE + '/reset-password' } })
    const [message] = await db.select().from(outboxMessages).where(eq(outboxMessages.kind, 'identity.reset-password'))
    const link = new URL((message!.payload as { url: string }).url)
    const token = link.searchParams.get('token') ?? link.pathname.split('/').pop()!
    const password = 'a new local password for Google'
    await auth.api.resetPassword({ body: { token, newPassword: password } })
    const result = await auth.api.signInEmail({ body: { email, password } })
    expect(result.user.id).toBe(first.session!.user.id)
    const rows = await db.select().from(authSchema.account).where(eq(authSchema.account.userId, result.user.id))
    expect(rows.map(row => row.providerId).sort()).toEqual(['credential', 'google'])
  })

  it('refuses an unverified Google email before creating a user', async () => {
    await mockGoogle()
    verified = false
    const result = await login()
    expect(result.session).toBeNull()
    expect(new URL(result.response.headers.get('location')!).searchParams.get('error')).toBe('google_email_unverified')
    expect(await db.select().from(authSchema.user)).toHaveLength(0)
  })

  it.each([
    { mustChangePassword: true },
    { role: 'superadmin' },
    { banned: true, banExpires: new Date(Date.now() + 86_400_000) },
  ])('never issues a Google session when the stored account is protected: %j', async (flags) => {
    await mockGoogle()
    const first = await login()
    const userId = first.session!.user.id
    await db.delete(authSchema.session).where(eq(authSchema.session.userId, userId))
    await db.update(authSchema.user).set(flags).where(eq(authSchema.user.id, userId))
    const refused = await login()
    expect(refused.session).toBeNull()
    expect(await db.select().from(authSchema.session).where(eq(authSchema.session.userId, userId))).toHaveLength(0)
    expect(new URL(refused.response.headers.get('location')!).searchParams.has('error')).toBe(true)
  })

  it.each(['customer', 'superadmin'])('challenges a Google %s before issuing any usable session', async (role) => {
    const password = 'existing long password'
    const created = await auth.api.signUpEmail({ body: { email, name: 'Existing Person', password }, returnHeaders: true })
    await db.update(authSchema.user).set({ emailVerified: true, role }).where(eq(authSchema.user.id, created.response.user.id))
    const setup = await auth.api.enableTwoFactor({ headers: sessionHeaders(created.headers), body: { password, method: 'totp' } })
    if (setup.method !== 'totp') throw new Error('Expected TOTP')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const bits = [...new URL(setup.totpURI).searchParams.get('secret')!.replace(/=+$/, '')].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
    const secret = String.fromCharCode(...bits.match(/.{8}/g)!.map(byte => Number.parseInt(byte, 2)))
    const code = async () => (await auth.api.generateTOTP({ body: { secret } })).code
    await auth.api.verifyTOTP({ headers: sessionHeaders(created.headers), body: { code: await code() } })
    await db.delete(authSchema.session)
    await mockGoogle()
    const response = await callback(await start())
    const challenge = sessionHeaders(response.headers)
    expect(await auth.api.getSession({ headers: challenge })).toBeNull()
    expect(await db.select().from(authSchema.session)).toHaveLength(0)
    expect(new URL(response.headers.get('location')!).searchParams.get('googleTwoFactor')).toBe('1')
    await expect(auth.api.verifyTOTP({ headers: challenge, body: { code: 'invalid' } })).rejects.toThrow()
    const verified = await auth.api.verifyTOTP({ headers: challenge, body: { code: await code() }, returnHeaders: true })
    expect((await auth.api.getSession({ headers: sessionHeaders(verified.headers) }))?.user).toMatchObject({ id: created.response.user.id, twoFactorEnabled: true, role })
    await expect(auth.api.verifyTOTP({ headers: challenge, body: { code: await code() } })).rejects.toThrow()
    const returning = await callback(await start())
    expect(new URL(returning.headers.get('location')!).searchParams.get('googleTwoFactor')).toBe('1')
    expect(await auth.api.getSession({ headers: sessionHeaders(returning.headers) })).toBeNull()
    const recovered = await auth.api.verifyBackupCode({ headers: sessionHeaders(returning.headers), body: { code: setup.backupCodes[0]! }, returnHeaders: true })
    expect((await auth.api.getSession({ headers: sessionHeaders(recovered.headers) }))?.user.id).toBe(created.response.user.id)
  })

  it('rejects missing, mismatched and replayed state without issuing a session', async () => {
    await mockGoogle()
    const flow = await start()
    const mismatch = await callback(flow, { state: 'wrong-state' })
    expect(await auth.api.getSession({ headers: sessionHeaders(mismatch.headers) })).toBeNull()
    const missing = await auth.handler(new Request(SITE + '/api/auth/callback/google?code=test-code'))
    expect(await auth.api.getSession({ headers: sessionHeaders(missing.headers) })).toBeNull()
    const valid = await start()
    const accepted = await callback(valid)
    expect(await auth.api.getSession({ headers: sessionHeaders(accepted.headers) })).not.toBeNull()
    const replay = await callback(valid)
    expect(await auth.api.getSession({ headers: sessionHeaders(replay.headers) })).toBeNull()
  })

  it('a cancelled consent keeps the browser signed out', async () => {
    await mockGoogle()
    const response = await callback(await start(), { error: 'access_denied' })
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('access_denied')
    expect(await auth.api.getSession({ headers: sessionHeaders(response.headers) })).toBeNull()
    expect(await db.select().from(authSchema.user)).toHaveLength(0)
  })

  it('moves only this browser guest\'s orders in both cafes on the OAuth callback', async () => {
    await ensureTenant(db)
    await ensureTenant(db, 'other-cafe')
    await insertBranch(db, { id: 'ours', name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
    await insertBranch(db, { id: 'theirs', name: 'Other cafe', timezone: 'Asia/Phnom_Penh', tenantId: 'other-cafe' })
    await mockGoogle()
    const guest = await auth.api.signInAnonymous({ returnHeaders: true })
    const stranger = await auth.api.signInAnonymous({ returnHeaders: true })
    for (const [i, customerId, tenantId, branchId] of [
      [1, guest.response.user.id, TEST_TENANT, 'ours'],
      [2, guest.response.user.id, 'other-cafe', 'theirs'],
      [3, stranger.response.user.id, TEST_TENANT, 'ours'],
    ] as const) {
      const now = new Date()
      await db.insert(orders).values({
        id: newId(), tenantId, branchId, customerId, businessDate: '2026-11-03',
        pickupNumber: i, orderType: 'pickup', subtotalMinor: 350, totalMinor: 350,
        placedAt: now, paymentDueAt: now, status: 'completed',
      })
    }
    const flow = await start(sessionHeaders(guest.headers))
    // Preserve this browser's guest cookie alongside the new state cookie.
    flow.headers.set('cookie', [sessionHeaders(guest.headers).get('cookie'), flow.headers.get('cookie')].filter(Boolean).join('; '))
    const response = await callback(flow)
    const signedIn = await auth.api.getSession({ headers: sessionHeaders(response.headers) })
    expect(signedIn?.user.isAnonymous).toBe(false)
    const rows = await db.select().from(orders).orderBy(orders.pickupNumber)
    expect(rows.map(r => r.customerId)).toEqual([signedIn!.user.id, signedIn!.user.id, stranger.response.user.id])
    expect(rows.map(r => r.tenantId)).toEqual([TEST_TENANT, 'other-cafe', TEST_TENANT])
  })
})
