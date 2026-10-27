import { afterEach, describe, expect, it, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as schema from '#auth/schema'
import { eq } from 'drizzle-orm'
import { user } from '#server/db/tables'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { createTestDb } from '#server/tests/support/db'
import { identityAuthOptions } from '#server/features/identity/identity.auth'
import { verifyHumanCheck } from '#server/features/identity/human-check'
import { humanCheckAction } from '#shared/utils/human-check'

const siteUrl = 'https://cafe.example'
const input = { action: 'sign_up' as const, token: 'fresh-token', secret: 'private-test-key', siteUrl, address: '203.0.113.9' }
const valid = { success: true, action: input.action, hostname: 'cafe.example' }
const answer = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => Response.json(body, { status }))
afterEach(() => vi.unstubAllGlobals())

describe('canonical human verification', () => {
  it('sends the bounded token to Siteverify with a deadline and checks exact action/hostname', async () => {
    const request = answer(valid)
    await verifyHumanCheck(input, request)
    const [url, options] = request.mock.calls[0]!
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(options?.method).toBe('POST')
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(Object.fromEntries(options?.body as URLSearchParams)).toEqual({ secret: input.secret, response: input.token, remoteip: input.address })
  })

  it.each([null, undefined, '', '   ', 'a'.repeat(2049)])('rejects absent/oversized tokens before an upstream call (%s)', async (token) => {
    const request = answer(valid)
    await expect(verifyHumanCheck({ ...input, token }, request)).rejects.toMatchObject({ body: { code: 'HUMAN_CHECK_FAILED' } })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    { ...valid, success: false }, { ...valid, success: 'true' },
    { ...valid, action: 'sign_in' }, { ...valid, action: undefined },
    { ...valid, hostname: 'localhost' }, { ...valid, hostname: 'cafe.example.evil.test' },
    { ...valid, hostname: undefined }, null, [],
  ])('rejects a forged, expired, wrong-action or wrong-host result %#', async (result) => {
    await expect(verifyHumanCheck(input, answer(result))).rejects.toMatchObject({ body: { code: 'HUMAN_CHECK_FAILED' } })
  })

  it.each([{ secret: '' }, { siteUrl: undefined }, { siteUrl: 'invalid' }])('fails closed for incomplete configuration %#', async (config) => {
    const request = answer(valid)
    await expect(verifyHumanCheck({ ...input, ...config }, request)).rejects.toMatchObject({ body: { code: 'HUMAN_CHECK_UNAVAILABLE' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('fails closed without exposing the token/key or upstream body on service errors', async () => {
    for (const request of [answer({ private: input.secret }, 503), vi.fn<typeof fetch>(async () => {
      throw new Error(input.token + input.secret)
    }), vi.fn<typeof fetch>(async () => new Response('not JSON'))]) {
      const error = await verifyHumanCheck(input, request).catch(error => error)
      expect(error.body.code).toBe('HUMAN_CHECK_UNAVAILABLE')
      expect(JSON.stringify(error)).not.toContain(input.secret)
      expect(JSON.stringify(error)).not.toContain(input.token)
    }
  })

  it('maps only the four selected auth actions, never checkout, 2FA, OAuth or callbacks', () => {
    expect(['/sign-in/email', '/sign-up/email', '/request-password-reset', '/send-verification-email'].map(humanCheckAction)).toEqual(['sign_in', 'sign_up', 'password_reset', 'verify_email'])
    for (const path of ['/sign-in/anonymous', '/two-factor/verify-totp', '/callback/google', '/reset-password', '/sign-out', '/api/health', '/api/webhooks/telegram', 'toString']) expect(humanCheckAction(path)).toBeUndefined()
  })
})

describe('the existing Better Auth handler with protection enabled', () => {
  async function setup() {
    const db = await createTestDb()
    const auth = betterAuth({
      ...identityAuthOptions({ db, siteUrl, checkBreachedPasswords: false, humanCheck: { enabled: true, secret: input.secret } }),
      baseURL: siteUrl,
      secret: 'test-auth-secret-at-least-32-characters',
      database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    })
    const submit = (path: string, body: unknown, token?: string) => auth.handler(new Request(`${siteUrl}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': siteUrl, ...(token ? { 'x-captcha-response': token } : {}) },
      body: JSON.stringify(body),
    }))
    return { db, submit }
  }
  const signup = (email: string) => ({ name: 'Dara', email, password: 'a valid test password' })

  it.each(['/sign-in/email', '/sign-up/email', '/request-password-reset', '/send-verification-email'])('refuses %s without a token before account/session/email side effects', async (path) => {
    const { db, submit } = await setup()
    const response = await submit(path, signup('dara@example.com'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'HUMAN_CHECK_FAILED' })
    expect(await db.select().from(user)).toHaveLength(0)
    expect(await db.select().from(outboxMessages)).toHaveLength(0)
  })

  it('permits a fresh signup once, rejects the replay, and leaves existing guest checkout available', async () => {
    const spent = new Set<string>()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
      const token = (init?.body as URLSearchParams).get('response')!
      if (spent.has(token)) return Response.json({ 'success': false, 'error-codes': ['timeout-or-duplicate'] })
      spent.add(token)
      return Response.json(valid)
    }))
    const { db, submit } = await setup()
    expect((await submit('/sign-up/email', signup('first@example.com'), 'one-time-token')).status).toBe(200)
    expect((await submit('/sign-up/email', signup('second@example.com'), 'one-time-token')).status).toBe(403)
    expect(await db.select().from(user).where(eq(user.email, 'second@example.com'))).toHaveLength(0)
    expect(await db.select().from(outboxMessages)).toHaveLength(1)
    expect((await submit('/sign-in/anonymous', {})).status).toBe(200)
  })
})
