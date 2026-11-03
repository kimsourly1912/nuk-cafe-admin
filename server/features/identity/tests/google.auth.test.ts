import { eq } from 'drizzle-orm'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '#auth/schema'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { orders } from '#server/features/orders/orders.schema'
import { identityAuthOptions } from '#server/features/identity/identity.auth'
import { createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { sessionHeaders, TEST_SITE as SITE } from '#server/tests/support/auth'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
const google = { enabled: true, clientId: 'test-client', clientSecret: 'test-secret' }
function createAuth() {
  return betterAuth({
    ...identityAuthOptions({ db, siteUrl: SITE, checkBreachedPasswords: false, google }),
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
    }
  })

  it('starts a state-bound Google redirect and rejects external callbacks and direct ID-token sign-in', async () => {
    const flow = await start()
    expect(flow.authorization.origin).toBe('https://accounts.google.com')
    expect(flow.authorization.searchParams.get('redirect_uri')).toBe(SITE + '/api/auth/callback/google')
    expect(flow.authorization.searchParams.get('state')).toBeTruthy()
    expect(flow.authorization.searchParams.get('prompt')).toBe('select_account')
    // Origin/callback checks run on HTTP requests. The trusted server API intentionally bypasses them.
    const external = await auth.handler(new Request(SITE + '/api/auth/sign-in/social', {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: 'https://evil.example' }),
    }))
    expect(external.status).toBe(403)
    await expect(auth.api.signInSocial({ body: { provider: 'google', idToken: { token: 'forged' } } })).rejects.toMatchObject({ body: { code: 'ID_TOKEN_NOT_SUPPORTED' } })
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

  it('never attaches Google to an existing same-email password account, verified or unverified', async () => {
    await mockGoogle()
    const created = await auth.api.signUpEmail({ body: { email, name: 'Existing Person', password: 'existing long password' } })
    for (const emailVerified of [false, true]) {
      await db.update(authSchema.user).set({ emailVerified }).where(eq(authSchema.user.id, created.user.id))
      const result = await login()
      expect(result.session).toBeNull()
      expect(new URL(result.response.headers.get('location')!).searchParams.get('error')).toBe('account_not_linked')
      expect(await db.select().from(authSchema.account).where(eq(authSchema.account.providerId, 'google'))).toHaveLength(0)
      expect(await db.select().from(authSchema.user)).toHaveLength(1)
    }
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
    { twoFactorEnabled: true },
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
