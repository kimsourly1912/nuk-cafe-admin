import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { auditEvents, session, user } from '#server/db/tables'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { createTestAuth, sessionHeaders, signIn } from '#server/tests/support/auth'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { SessionUser } from '#server/features/identity/identity.types'
import type { TenantPermission } from '#server/features/identity'
import { allowSupport, closeSupportVisits, endSupport, getCafeSupport, openSupportVisit, supportActor, supportSession, tenantSupport } from '#server/features/support'
import { supportGrants, supportVisits } from '#server/features/support/support.schema'

// Support access (step P5, D193): the owner's grant, a super admin's visit after a fresh code,
// and the read-only actor of the cafe's admin during it. Against SQLite built from the migrations.

let db: Db
const OTHER = 'tenant-2'
const SUPER = '0a1b2c3d-0000-4000-8000-0000000000a1'
const SESSION = 'session-1'
const NOW = new Date('2026-10-19T05:00:00Z')
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)
const superUser = (overrides: Partial<SessionUser> = {}) => ({ id: SUPER, email: 'ops@example.com', name: 'Ops', role: 'superadmin', twoFactorEnabled: true, banned: false, mustChangePassword: false, ...overrides }) as SessionUser
const visitor = { userId: SUPER, sessionId: SESSION, requestId: 'req-1' }
const right = async () => true
const wrong = async () => false
let owner: { userId: string }
const ownerActor = () => ({ userId: owner.userId, tenantId: TEST_TENANT, role: 'owner' as const })
const request = (overrides: Record<string, unknown> = {}) => ({ user: superUser(), sessionId: SESSION, tenantId: TEST_TENANT, method: 'GET', path: '/api/c/nuk/admin/menu/items', requestId: 'req-2', ...overrides })
const audits = (action: string) => db.select({ tenantId: auditEvents.tenantId, actorId: auditEvents.actorId, metadata: auditEvents.metadata }).from(auditEvents).where(eq(auditEvents.action, action))

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
  await ensureTenant(db, OTHER, 'brown-bean')
  owner = await createAdmin(db, 'owner@example.com')
  await db.insert(user).values({ id: SUPER, email: 'ops@example.com', name: 'Ops', role: 'superadmin', twoFactorEnabled: true })
})

describe('the owner allows platform support', () => {
  it('for 24 hours, once at a time, audited, in their cafe only', async () => {
    const support = await allowSupport(db, ownerActor(), NOW)
    expect(support.active).toMatchObject({ grantedBy: { id: owner.userId, name: 'Admin' }, grantedAt: NOW.toISOString(), expiresAt: minutes(24 * 60).toISOString(), active: true, visits: [] })
    expect(await tenantSupport(db, TEST_TENANT, NOW)).toEqual({ grantedAt: NOW.toISOString(), expiresAt: minutes(24 * 60).toISOString() })
    await expectApiError(() => allowSupport(db, ownerActor(), minutes(1)), 409, 'SUPPORT_ALREADY_ALLOWED')
    expect(await audits('support.grant')).toEqual([{ tenantId: TEST_TENANT, actorId: owner.userId, metadata: { expiresAt: minutes(24 * 60).toISOString() } }])
    // Another cafe has none.
    expect(await tenantSupport(db, OTHER, NOW)).toBeNull()
    expect(await getCafeSupport(db, OTHER, NOW)).toEqual({ active: null, history: [] })
    // Expired, it's history, and it can be allowed again.
    expect((await getCafeSupport(db, TEST_TENANT, minutes(24 * 60))).active).toBeNull()
    await allowSupport(db, ownerActor(), minutes(24 * 60 + 1))
  })

  it('two owners allowing it at once make one grant', async () => {
    const racing = interleaved(db, () => allowSupport(db, ownerActor(), NOW))
    await expectApiError(() => allowSupport(racing, ownerActor(), NOW), 409, 'SUPPORT_ALREADY_ALLOWED')
    expect(await db.select().from(supportGrants)).toHaveLength(1)
  })

  it('ends at once with its visits; another cafe\'s grant or an ended one is 404', async () => {
    const { active } = await allowSupport(db, ownerActor(), NOW)
    await openSupportVisit(db, visitor, TEST_TENANT, right, minutes(1))
    const ended = await endSupport(db, ownerActor(), active!.id, minutes(2))
    expect(ended.active).toBeNull()
    expect(ended.history[0]).toMatchObject({ endedAt: minutes(2).toISOString(), endedBy: { id: owner.userId }, visits: [{ by: { id: SUPER, name: 'Ops' }, closedAt: minutes(2).toISOString() }] })
    expect(await supportActor(db, request(), { menu: ['read'] }, minutes(3))).toBeUndefined()
    await expectApiError(() => endSupport(db, ownerActor(), active!.id, minutes(3)), 404, 'NOT_FOUND')
    await allowSupport(db, ownerActor(), minutes(4))
    const grant = (await getCafeSupport(db, TEST_TENANT, minutes(4))).active!
    const otherOwner = await createAdmin(db, 'other@example.com', OTHER)
    await expectApiError(() => endSupport(db, { userId: otherOwner.userId, tenantId: OTHER, role: 'owner' }, grant.id, minutes(5)), 404, 'NOT_FOUND')
    expect((await getCafeSupport(db, TEST_TENANT, minutes(5))).active?.id).toBe(grant.id)
  })
})

describe('a super admin opens the cafe', () => {
  it('only while the owner allows it, after a right code, for an hour at most, audited', async () => {
    await expectApiError(() => openSupportVisit(db, visitor, TEST_TENANT, right, NOW), 409, 'SUPPORT_NOT_ALLOWED')
    await allowSupport(db, ownerActor(), NOW)
    const opened = await openSupportVisit(db, visitor, TEST_TENANT, right, minutes(1))
    expect(opened).toEqual({ path: '/c/nuk/admin', expiresAt: minutes(61).toISOString() })
    expect((await audits('tenant.support.open'))[0]).toMatchObject({ tenantId: TEST_TENANT, actorId: SUPER })
  })

  it('a visit never outlasts the grant', async () => {
    await allowSupport(db, ownerActor(), NOW)
    const opened = await openSupportVisit(db, visitor, TEST_TENANT, right, minutes(24 * 60 - 10))
    expect(opened.expiresAt).toBe(minutes(24 * 60).toISOString())
  })

  it('a wrong code is audited and refused; after five in 15 minutes, even a right one waits', async () => {
    // Audit rows take the database's clock: this test runs on the real one.
    const now = new Date()
    await allowSupport(db, ownerActor(), now)
    for (let i = 0; i < 5; i++) await expectApiError(() => openSupportVisit(db, visitor, TEST_TENANT, wrong, now), 422, 'INVALID_CODE', ['code'])
    expect(await audits('tenant.support.code-failed')).toHaveLength(5)
    await expectApiError(() => openSupportVisit(db, visitor, TEST_TENANT, right, now), 429, 'RATE_LIMITED')
    expect(await db.select().from(supportVisits)).toEqual([])
    // Another super admin isn't held back by these.
    await openSupportVisit(db, { ...visitor, userId: 'superadmin-2' }, TEST_TENANT, right, now)
    // Later, it opens.
    await openSupportVisit(db, visitor, TEST_TENANT, right, new Date(now.getTime() + 16 * 60_000))
  })

  it('the owner ending it between the check and the save opens nothing', async () => {
    const { active } = await allowSupport(db, ownerActor(), NOW)
    const racing = interleaved(db, () => endSupport(db, ownerActor(), active!.id, minutes(1)))
    await expectApiError(() => openSupportVisit(racing, visitor, TEST_TENANT, right, minutes(1)), 409, 'SUPPORT_NOT_ALLOWED')
    expect(await db.select().from(supportVisits)).toEqual([])
  })
})

describe('the cafe\'s admin during a visit', () => {
  beforeEach(async () => {
    await allowSupport(db, ownerActor(), NOW)
    await openSupportVisit(db, visitor, TEST_TENANT, right, minutes(1))
  })

  it('reads, as support, each request audited without its query', async () => {
    const actor = await supportActor(db, request(), { menu: ['read'] }, minutes(2))
    expect(actor).toEqual({ userId: SUPER, tenantId: TEST_TENANT, role: 'support', requestId: 'req-2' })
    const [row] = await audits('support.request')
    expect(row).toMatchObject({ tenantId: TEST_TENANT, actorId: SUPER, metadata: { method: 'GET', path: '/api/c/nuk/admin/menu/items' } })
  })

  it('never writes, whatever the permission asked', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      await expectApiError(() => supportActor(db, request({ method }), { menu: ['read'] }, minutes(2)), 403, 'SUPPORT_READ_ONLY')
    }
    await expectApiError(() => supportActor(db, request(), { menu: ['write'] }, minutes(2)), 403, 'FORBIDDEN')
  })

  it('reads only what support may: no exports, assistant, uploads or staff changes', async () => {
    const denied: TenantPermission[] = [{ report: ['export'] }, { assistant: ['use'] }, { media: ['upload'] }, { staff: ['create'] }, { support: ['grant'] }, { menu: ['read'], report: ['export'] }]
    for (const permissions of denied) {
      await expectApiError(() => supportActor(db, request(), permissions, minutes(2)), 403, 'FORBIDDEN')
    }
    const allowed: TenantPermission[] = [{ report: ['read'] }, { staff: ['read'] }, { settings: ['manage'] }, { branch: ['read', 'update'] }]
    for (const permissions of allowed) {
      expect(await supportActor(db, request(), permissions, minutes(2))).toMatchObject({ role: 'support' })
    }
  })

  it('is this session\'s, in this cafe, for a super admin with two-step sign-in, until it ends', async () => {
    expect(await supportActor(db, request({ sessionId: 'session-2' }), { menu: ['read'] }, minutes(2))).toBeUndefined()
    expect(await supportActor(db, request({ tenantId: OTHER }), { menu: ['read'] }, minutes(2))).toBeUndefined()
    expect(await supportActor(db, request({ user: superUser({ role: 'customer' }) }), { menu: ['read'] }, minutes(2))).toBeUndefined()
    expect(await supportActor(db, request({ user: superUser({ twoFactorEnabled: false }) }), { menu: ['read'] }, minutes(2))).toBeUndefined()
    expect(await supportActor(db, request({ user: superUser({ banned: true }) }), { menu: ['read'] }, minutes(2))).toBeUndefined()
    expect(await supportActor(db, request({ user: superUser({ id: 'someone-else' }) }), { menu: ['read'] }, minutes(2))).toBeUndefined()
    expect(await supportActor(db, request({ sessionId: undefined }), { menu: ['read'] }, minutes(2))).toBeUndefined()
    // After the hour, a new code.
    expect(await supportActor(db, request(), { menu: ['read'] }, minutes(62))).toBeUndefined()
    // Left: closed.
    await closeSupportVisits(db, visitor, TEST_TENANT, minutes(3))
    expect(await supportActor(db, request(), { menu: ['read'] }, minutes(4))).toBeUndefined()
  })

  it('the admin app\'s session is read-only, with when it ends', async () => {
    const admin = await supportSession(db, request({ path: '/api/c/nuk/admin/me' }), minutes(2))
    expect(admin).toMatchObject({ userId: SUPER, role: 'support', mustChangePassword: false, support: { visitExpiresAt: minutes(61).toISOString(), grantExpiresAt: minutes(24 * 60).toISOString() } })
    expect(admin!.permissions).toContain('menu:read')
    expect(admin!.permissions.some(permission => /write|create|update:|disable|export|publish|upload|grant|use$/.test(permission) && permission !== 'branch:update')).toBe(false)
    expect(await supportSession(db, request({ tenantId: OTHER }), minutes(2))).toBeUndefined()
  })
})

describe('the code check (Better Auth, a signed-in session)', () => {
  it('accepts the app\'s current code, refuses another, and changes no session', async () => {
    const auth = createTestAuth(db)
    await auth.api.signUpEmail({ body: { email: 'second@example.com', password: 'the super admin password', name: 'Second' } })
    let headers = await signIn(auth, 'second@example.com', 'the super admin password')
    const { totpURI } = await auth.api.enableTwoFactor({ headers, body: { password: 'the super admin password', method: 'totp' } }) as { totpURI: string }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const bits = [...new URL(totpURI).searchParams.get('secret')!.replace(/=+$/, '')].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('')
    const secret = String.fromCharCode(...bits.match(/.{8}/g)!.map(byte => Number.parseInt(byte, 2)))
    const code = async () => (await auth.api.generateTOTP({ body: { secret } })).code
    const { headers: swapped } = await auth.api.verifyTOTP({ headers, body: { code: await code() }, returnHeaders: true })
    headers = sessionHeaders(swapped)
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, 'second@example.com'))
    const before = await db.select({ id: session.id }).from(session).where(eq(session.userId, row!.id))

    const check = (value: string) => auth.api.verifyTOTP({ headers, body: { code: value } }).then(() => true, () => false)
    expect(await check(await code())).toBe(true)
    expect(await check('000000')).toBe(false)
    expect(await db.select({ id: session.id }).from(session).where(and(eq(session.userId, row!.id)))).toEqual(before)
  })
})
