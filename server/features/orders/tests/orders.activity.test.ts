import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import { describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { orders } from '#server/features/orders/orders.schema'
import { orderActivityQuery } from '#server/features/orders/orders.repository'
import { orderActivity } from '#server/features/orders/orders.service'
import { createTestDb, createUser, ensureTenant, insertBranch, migrationFiles } from '#server/tests/support/db'

describe('platform order activity (indexed tenant reads)', () => {
  it('keeps old-only last order dates, counts the 30-day boundary and excludes other cafes', async () => {
    const db = await createTestDb()
    const now = new Date('2026-11-02T00:00:00.000Z')
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const customer = await createUser(db)
    for (const tenantId of ['activity-a', 'activity-b']) {
      await ensureTenant(db, tenantId)
      await insertBranch(db, { id: tenantId + '-branch', tenantId, name: 'Branch', timezone: 'Asia/Phnom_Penh' })
    }
    const makeOrder = (tenantId: string, number: number, placedAt: Date) => ({
      tenantId,
      branchId: tenantId + '-branch',
      customerId: customer.id,
      businessDate: '2026-11-01',
      pickupNumber: number,
      orderType: 'pickup' as const,
      subtotalMinor: 100,
      totalMinor: 100,
      placedAt,
      paymentDueAt: placedAt,
    })
    await db.insert(orders).values([
      makeOrder('activity-a', 1, new Date(since.getTime() - 1)),
      makeOrder('activity-a', 2, since),
      makeOrder('activity-a', 3, new Date(since.getTime() + 1)),
      makeOrder('activity-b', 1, new Date(since.getTime() - 10_000)),
    ])
    const rows = await orderActivity(db, ['activity-a', 'activity-b', 'no-orders'], now)
    expect(rows.get('activity-a')).toEqual({ recent: 2, lastPlacedAt: new Date(since.getTime() + 1) })
    expect(rows.get('activity-b')).toEqual({ recent: 0, lastPlacedAt: new Date(since.getTime() - 10_000) })
    expect(rows.has('no-orders')).toBe(false)
    expect([...rows.keys()].sort()).toEqual(['activity-a', 'activity-b'])
    expect(await orderActivity(db, [], now)).toEqual(new Map())
  })

  it('returns one result for duplicated cafe IDs and supports more than 100 requested IDs', async () => {
    const db = await createTestDb()
    const now = new Date('2026-11-02T00:00:00.000Z')
    const rows = await orderActivity(db, [...Array.from({ length: 120 }, (_, i) => 'missing-' + i), 'missing-1', 'missing-1'], now)
    expect(rows.size).toBe(0)
  })

  it('uses the tenant and placed-at index for both correlated reads on local D1', { tags: ['slow'] }, async () => {
    const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../../../tests/support/d1-wrangler.json', import.meta.url)), persist: false })
    const d1 = proxy.env.DB as {
      prepare: (sql: string) => {
        bind: (...params: unknown[]) => { all: () => Promise<{ results: { detail: string }[] }> }
        all: () => Promise<unknown>
      }
    }
    try {
      for (const file of migrationFiles()) {
        const source = readFileSync(fileURLToPath(new URL(`../../../db/migrations/sqlite/${file}`, import.meta.url)), 'utf8')
        for (const statement of source.split('--> statement-breakpoint')) {
          if (statement.trim()) await d1.prepare(statement).all()
        }
      }
      const db = drizzle(d1 as never, { casing: 'snake_case' }) as unknown as Db
      const query = orderActivityQuery(db, ['plan-cafe-a', 'plan-cafe-b'], new Date('2026-11-02T00:00:00.000Z')).toSQL()
      const plan = await d1.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.params).all()
      const indexedReads = plan.results.map(row => row.detail).filter(detail => detail.includes('orders_tenant_placed_idx'))
      expect(indexedReads).toHaveLength(3)
    }
    finally {
      await proxy.dispose()
    }
  })
})
