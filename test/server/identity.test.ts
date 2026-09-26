import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { auditEvents, staffProfiles } from '../../server/db/tables'
import type { Db } from '../../server/db/types'
import { authorizeStaff, bootstrapAdmin } from '../../server/features/identity/service'
import { createAdmin, createTestDb, createUser } from './support/db'
import { failure } from './support/failure'

const TOKEN = 'x'.repeat(32)

let db: Db
beforeEach(async () => {
  db = await createTestDb()
})

describe('authorizeStaff', () => {
  it('rejects a request without a session (401)', async () => {
    expect(await failure(authorizeStaff(db, null, 'menu.read'))).toEqual({ status: 401, code: 'UNAUTHENTICATED' })
  })

  it('rejects a signed-in account that is not staff, e.g. a customer (403)', async () => {
    const customer = await createUser(db)
    expect(await failure(authorizeStaff(db, customer.id, 'menu.read'))).toEqual({ status: 403, code: 'NOT_STAFF' })
  })

  it('rejects a disabled staff member (403)', async () => {
    const admin = await createAdmin(db)
    await db.update(staffProfiles).set({ status: 'disabled' }).where(eq(staffProfiles.userId, admin.userId))
    expect(await failure(authorizeStaff(db, admin.userId, 'menu.read'))).toEqual({ status: 403, code: 'NOT_STAFF' })
  })

  it('returns an admin with every permission', async () => {
    const admin = await createAdmin(db, 'boss@example.com')
    const staff = await authorizeStaff(db, admin.userId, 'menu.write')
    expect(staff).toMatchObject({ userId: admin.userId, email: 'boss@example.com', role: 'admin' })
    expect(staff.permissions).toEqual(['menu.read', 'menu.write', 'media.write'])
  })
})

describe('bootstrapAdmin', () => {
  it('is disabled without a long enough server token', async () => {
    await createUser(db, 'owner@example.com')
    const input = { token: 'short', email: 'owner@example.com' }
    expect(await failure(bootstrapAdmin(db, undefined, input))).toEqual({ status: 404, code: 'BOOTSTRAP_DISABLED' })
    expect(await failure(bootstrapAdmin(db, 'short', input))).toEqual({ status: 404, code: 'BOOTSTRAP_DISABLED' })
  })

  it('rejects a wrong token', async () => {
    await createUser(db, 'owner@example.com')
    const result = await failure(bootstrapAdmin(db, TOKEN, { token: 'y'.repeat(32), email: 'owner@example.com' }))
    expect(result).toEqual({ status: 403, code: 'FORBIDDEN' })
  })

  it('needs an existing account', async () => {
    const result = await failure(bootstrapAdmin(db, TOKEN, { token: TOKEN, email: 'nobody@example.com' }))
    expect(result).toEqual({ status: 404, code: 'USER_NOT_FOUND' })
  })

  it('makes the account the first admin, with an audit event', async () => {
    const owner = await createUser(db, 'owner@example.com', 'Owner')
    const staff = await bootstrapAdmin(db, TOKEN, { token: TOKEN, email: 'owner@example.com' })
    expect(staff).toMatchObject({ userId: owner.id, displayName: 'Owner', role: 'admin' })
    const events = await db.select().from(auditEvents)
    expect(events).toMatchObject([{ actorUserId: owner.id, action: 'staff.bootstrap_admin', targetId: owner.id }])
  })

  it('refuses once an admin exists, even for another account', async () => {
    await createUser(db, 'owner@example.com')
    await createUser(db, 'other@example.com')
    await bootstrapAdmin(db, TOKEN, { token: TOKEN, email: 'owner@example.com' })
    const again = await failure(bootstrapAdmin(db, TOKEN, { token: TOKEN, email: 'other@example.com' }))
    expect(again).toEqual({ status: 409, code: 'ADMIN_EXISTS' })
    expect(await db.select().from(staffProfiles)).toHaveLength(1)
  })

  it('creates one admin when two calls race', async () => {
    await createUser(db, 'a@example.com')
    await createUser(db, 'b@example.com')
    const results = await Promise.allSettled([
      bootstrapAdmin(db, TOKEN, { token: TOKEN, email: 'a@example.com' }),
      bootstrapAdmin(db, TOKEN, { token: TOKEN, email: 'b@example.com' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await db.select().from(staffProfiles)).toHaveLength(1)
  })
})
