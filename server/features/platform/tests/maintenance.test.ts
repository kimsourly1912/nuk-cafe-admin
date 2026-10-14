import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { expireIdempotencyKeys, maintainOutbox, outboxStatement } from '#server/features/platform'
import { idempotencyKeys, outboxMessages } from '#server/features/platform/platform.schema'
import { createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'

describe('bounded platform maintenance', () => {
  it('scrubs expired account links, preserving unexpired links and unrelated failed work', async () => {
    const db = await createTestDb()
    const now = new Date()
    await db.batch([
      outboxStatement(db, null, 'identity.reset-password', { url: 'expired', to: 'person@example.com' }),
      outboxStatement(db, null, 'identity.verify-email', { url: 'still-valid' }),
      outboxStatement(db, null, 'orders.placed', { orderId: 'keep' }),
    ])
    await db.update(outboxMessages).set({ createdAt: new Date(now.getTime() - 2 * 3600_000) })
    expect(await maintainOutbox(db, { now, limit: 1 })).toEqual({ redacted: 1, removed: 0 })
    const rows = await db.select().from(outboxMessages)
    expect(rows.find(row => row.kind === 'identity.reset-password')).toMatchObject({ payload: {}, status: 'failed' })
    expect(rows.find(row => row.kind === 'identity.verify-email')?.payload).toEqual({ url: 'still-valid' })
    expect(rows.find(row => row.kind === 'orders.placed')?.payload).toEqual({ orderId: 'keep' })
  })

  it('keeps metadata by default; configured retention removes only a bounded page of sent work', async () => {
    const db = await createTestDb()
    const now = new Date()
    for (let i = 0; i < 3; i++) await db.batch([outboxStatement(db, null, 'mail.test', {})])
    await db.update(outboxMessages).set({ status: 'sent', sentAt: new Date(now.getTime() - 10 * 86400_000) })
    const [pending] = await db.select().from(outboxMessages)
    await db.update(outboxMessages).set({ status: 'pending' }).where(eq(outboxMessages.id, pending!.id))
    expect(await maintainOutbox(db, { now })).toEqual({ redacted: 0, removed: 0 })
    expect(await maintainOutbox(db, { now, sentRetentionDays: 7, limit: 1 })).toEqual({ redacted: 0, removed: 1 })
    expect(await maintainOutbox(db, { now, sentRetentionDays: 7, limit: 1 })).toEqual({ redacted: 0, removed: 1 })
    expect(await db.select().from(outboxMessages)).toHaveLength(1)
    expect((await db.select().from(outboxMessages))[0]?.status).toBe('pending')
  })

  it('expires keys across cafes in bounded batches', async () => {
    const db = await createTestDb()
    await ensureTenant(db)
    await ensureTenant(db, 'other')
    const now = new Date()
    await db.insert(idempotencyKeys).values([TEST_TENANT, 'other', TEST_TENANT].map((tenantId, i) => ({ tenantId, actorId: 'actor', operation: 'test', key: String(i), requestHash: 'hash', expiresAt: new Date(now.getTime() - 1) })))
    expect(await expireIdempotencyKeys(db, now, 2)).toBe(2)
    expect(await db.select().from(idempotencyKeys)).toHaveLength(1)
    expect(await expireIdempotencyKeys(db, now, 2)).toBe(1)
  })
})
