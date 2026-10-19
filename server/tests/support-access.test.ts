import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import type { Db } from '#server/utils/batch'
import { user } from '#server/db/tables'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { allowSupport, openSupportVisit } from '#server/features/support'

// `requirePermission` (server/utils/access.ts) during a support visit (step P5, D193): the cafe's
// own people go through their role as before; a refused super admin with an open visit reads, GET
// only. The route helpers, with Nitro's globals stood in for.

let db: Db
vi.mock('#server/utils/db', () => ({ useDb: () => db }))
const SUPER = '0a1b2c3d-0000-4000-8000-0000000000a1'
let current: { user: Record<string, unknown>, session: { id: string } } | null

function eventOf(method: string, path = '/api/c/nuk/admin/menu/items') {
  return { method, context: {}, path, node: { req: { url: path, headers: {} } } } as unknown as H3Event
}

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db, TEST_TENANT, 'nuk')
  await db.insert(user).values({ id: SUPER, email: 'ops@example.com', name: 'Ops', role: 'superadmin', twoFactorEnabled: true })
  vi.stubGlobal('getUserSession', async () => current)
  vi.stubGlobal('getRouterParam', (_event: H3Event, name: string) => (name === 'slug' ? 'nuk' : undefined))
  vi.stubGlobal('getRequestURL', (event: H3Event) => new URL(`https://cafe.example${(event as unknown as { path: string }).path}`))
  current = { user: { id: SUPER, email: 'ops@example.com', name: 'Ops', role: 'superadmin', twoFactorEnabled: true }, session: { id: 'session-1' } }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requirePermission and support access', () => {
  it('refuses a super admin without a visit, and lets one with a visit read but never write', async () => {
    const { requirePermission } = await import('#server/utils/access')
    await expectApiError(() => requirePermission(eventOf('GET'), { menu: ['read'] }), 403, 'FORBIDDEN')

    const owner = await createAdmin(db, 'owner@example.com')
    await allowSupport(db, { userId: owner.userId, tenantId: TEST_TENANT, role: 'owner' })
    await openSupportVisit(db, { userId: SUPER, sessionId: 'session-1' }, TEST_TENANT, async () => true)

    expect(await requirePermission(eventOf('GET'), { menu: ['read'] })).toMatchObject({ userId: SUPER, tenantId: TEST_TENANT, role: 'support' })
    await expectApiError(() => requirePermission(eventOf('POST'), { menu: ['write'] }), 403, 'SUPPORT_READ_ONLY')
    await expectApiError(() => requirePermission(eventOf('GET'), { report: ['export'] }), 403, 'FORBIDDEN')

    // Another session of the same super admin: no visit there.
    current = { ...current!, session: { id: 'session-2' } }
    await expectApiError(() => requirePermission(eventOf('GET'), { menu: ['read'] }), 403, 'FORBIDDEN')

    // The cafe's owner is unaffected: their role decides.
    current = { user: { id: owner.userId, email: 'owner@example.com', name: 'Admin', role: 'customer' }, session: { id: 'owner-session' } }
    expect(await requirePermission(eventOf('POST'), { menu: ['write'] })).toMatchObject({ role: 'owner' })
  })
})
