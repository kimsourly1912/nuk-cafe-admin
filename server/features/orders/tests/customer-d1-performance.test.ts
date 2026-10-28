import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { createUser, insertBranch, migrationFiles } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'
import { eventStatement, findCustomerOrdersInProgress, insertOrderStatement, requireUnpaidAtMost } from '#server/features/orders/orders.repository'
import { orderEvents, orders } from '#server/features/orders/orders.schema'

interface Query { sql: string, params: unknown[] }
interface Result { results: Record<string, unknown>[], meta: { rows_read: number } }
interface Prepared { bind: (...params: unknown[]) => Prepared, all: () => Promise<Result>, run: () => Promise<unknown> }

it('bounds customer reads and preserves the atomic unpaid limit on local D1', { tags: ['slow'] }, async () => {
  const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../../../tests/support/d1-wrangler.json', import.meta.url)), persist: false })
  const d1 = proxy.env.DB as { prepare: (sql: string) => Prepared, batch: (statements: Prepared[]) => Promise<unknown> }
  const migration = readFileSync(fileURLToPath(new URL('../../../db/migrations/sqlite/0050_orders_customer_status.sql', import.meta.url)), 'utf8')
  const migrationStatements = migration.split('--> statement-breakpoint')
  const applyIndex = () => d1.batch(migrationStatements.map(statement => d1.prepare(statement)))
  try {
    for (const file of migrationFiles()) {
      const source = readFileSync(fileURLToPath(new URL(`../../../db/migrations/sqlite/${file}`, import.meta.url)), 'utf8')
      await d1.batch(source.split('--> statement-breakpoint').filter(statement => statement.trim()).map(statement => d1.prepare(statement)))
    }
    const queries: Query[] = []
    const db = drizzle(d1 as never, { casing: 'snake_case', logger: { logQuery: (sql, params) => queries.push({ sql, params }) } }) as unknown as Db
    const person = await createUser(db, 'customer-index@example.com', 'Customer')
    const other = await createUser(db, 'other-index@example.com', 'Other')
    for (const [id, tenantId] of [['customer-a', 'customer-a'], ['customer-a2', 'customer-a'], ['customer-b', 'customer-b']]) {
      await insertBranch(db, { id: id!, tenantId: tenantId!, name: id!, timezone: 'Asia/Phnom_Penh' })
    }
    const now = new Date('2026-10-27T05:00:00Z')
    const old = new Date('2026-01-01T05:00:00Z')
    const base = { tenantId: 'customer-a', branchId: 'customer-a', customerId: person.id, businessDate: '2026-01-01', orderType: 'pickup' as const, subtotalMinor: 100, totalMinor: 100, placedAt: old, paymentDueAt: old }
    // Bulk synthetic fixture only: avoid thousands of driver calls before measuring real SQL.
    await d1.prepare(`WITH RECURSIVE series(i) AS (VALUES(0) UNION ALL SELECT i + 1 FROM series WHERE i < 7999)
      INSERT INTO orders (id, tenant_id, branch_id, customer_id, business_date, pickup_number, order_type, subtotal_minor, total_minor, placed_at, payment_due_at, status)
      SELECT 'history-' || i,
        CASE WHEN i >= 5000 AND i < 6000 THEN 'customer-b' ELSE 'customer-a' END,
        CASE WHEN i >= 5000 AND i < 6000 THEN 'customer-b' ELSE 'customer-a' END,
        CASE WHEN i >= 6000 THEN ? ELSE ? END, '2026-01-01', i + 1, 'pickup', 100, 100, ?,
        CASE WHEN i >= 6000 THEN ? ELSE ? END,
        CASE WHEN i >= 6000 THEN 'awaiting_payment' WHEN i % 2 THEN 'cancelled' ELSE 'completed' END
      FROM series`).bind(other.id, person.id, old.getTime(), now.getTime() + 1, old.getTime()).run()
    const active = [
      { id: 'active-unpaid', status: 'awaiting_payment' as const, paymentDueAt: new Date(now.getTime() + 1) },
      { id: 'active-expired', status: 'awaiting_payment' as const, paymentDueAt: new Date(now.getTime() - 1) },
      { id: 'active-boundary', status: 'awaiting_payment' as const, paymentDueAt: now },
      { id: 'active-preparing', status: 'preparing' as const, paymentDueAt: old },
      { id: 'active-ready-a', status: 'ready' as const, paymentDueAt: old },
      { id: 'active-ready-z', status: 'ready' as const, paymentDueAt: old },
    ]
    for (const [i, row] of active.entries()) {
      await db.insert(orders).values({ ...base, ...row, placedAt: i === 3 ? old : now, pickupNumber: 8001 + i })
      await db.insert(orders).values({ ...base, ...row, id: `other-${row.id}`, tenantId: 'customer-b', branchId: 'customer-b', pickupNumber: 8001 + i })
    }
    // The limit is per cafe, across its branches; paid work can be arbitrarily old.
    await db.insert(orders).values({ ...base, id: 'active-other-branch', branchId: 'customer-a2', status: 'ready', pickupNumber: 1 })
    queries.length = 0
    const snapshot = await findCustomerOrdersInProgress(db, 'customer-a', person.id, 100)
    const activeQuery = queries[0]!
    expect(snapshot.map(row => row.id)).toEqual(['active-unpaid', 'active-ready-z', 'active-ready-a', 'active-expired', 'active-boundary', 'active-preparing', 'active-other-branch'])
    expect((await findCustomerOrdersInProgress(db, 'customer-a', person.id, 3)).map(row => row.id)).toEqual(snapshot.slice(0, 3).map(row => row.id))
    expect(await findCustomerOrdersInProgress(db, 'customer-a', 'missing', 100)).toEqual([])
    expect((await findCustomerOrdersInProgress(db, 'customer-b', person.id, 100)).map(row => row.id)).toEqual(active.map(row => `other-${row.id}`).sort().reverse())
    const guard = requireUnpaidAtMost(db, 'customer-a', person.id, now, 1) as unknown as { toSQL: () => Query }
    const reads = [activeQuery, guard.toSQL()]
    const measure = async (indexed: boolean) => {
      const results = []
      for (const query of reads) {
        const plan = await d1.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).bind(...query.params).all()
        const result = await d1.prepare(query.sql).bind(...query.params).all()
        if (indexed) {
          const search = plan.results.map(row => String(row.detail)).find(detail => detail.includes('orders_tenant_customer_status_due_idx'))
          expect(search, JSON.stringify(plan.results)).toContain('tenant_id=? AND customer_id=? AND status=?')
          if (query === reads[1]) expect(search).toContain('payment_due_at>?')
        }
        results.push({ rowsRead: result.meta.rows_read, rows: result.results })
      }
      return results
    }
    await d1.prepare('DROP INDEX orders_tenant_customer_status_due_idx').run()
    const beforeCold = await measure(false)
    await d1.prepare(migrationStatements[0]!).run()
    const afterCold = await measure(false)
    expect(afterCold.map(row => row.rows)).toEqual(beforeCold.map(row => row.rows))
    // Apply the whole rollout migration atomically to populated data, including optimize.
    await d1.prepare('DROP INDEX orders_tenant_customer_status_due_idx').run()
    await applyIndex()
    const afterOptimized = await measure(true)
    await d1.prepare('DROP INDEX orders_tenant_customer_status_due_idx').run()
    await d1.prepare('ANALYZE').run()
    const beforeAnalyzed = await measure(false)
    await applyIndex()
    await d1.prepare('ANALYZE').run()
    const afterAnalyzed = await measure(true)
    for (const [before, after] of [[beforeCold, afterOptimized], [beforeAnalyzed, afterAnalyzed]]) {
      expect(after!.map(row => row.rows)).toEqual(before!.map(row => row.rows))
      expect(after![0]!.rowsRead).toBeLessThan(60)
      expect(after![1]!.rowsRead).toBeLessThan(10)
      for (const [i, row] of after!.entries()) expect(row.rowsRead).toBeLessThan(before![i]!.rowsRead / 10)
    }
    expect(await findCustomerOrdersInProgress(db, 'customer-a', person.id, 100)).toEqual(snapshot)
    // Exactly-at-deadline is expired; another cafe/customer's unpaid orders do not count.
    await db.batch([requireUnpaidAtMost(db, 'customer-a', person.id, now, 1)])
    await expect(db.batch([requireUnpaidAtMost(db, 'customer-a', person.id, now, 0)])).rejects.toThrow()
    await expect(db.batch([requireUnpaidAtMost(db, 'customer-a', other.id, now, 2)])).rejects.toThrow()

    const race = await createUser(db, 'race-index@example.com', 'Racer')
    const placement = (id: string, branchId: string) => {
      const order = { ...base, id, branchId, customerId: race.id, source: null, tableId: null, tableLabel: null, placedAt: now, paymentDueAt: new Date(now.getTime() + 1) }
      return db.batch([
        insertOrderStatement(db, order),
        eventStatement(db, { tenantId: base.tenantId, orderId: id, toVersion: 1, actorId: race.id, fromStatus: null, toStatus: 'awaiting_payment', at: now }),
        requireUnpaidAtMost(db, base.tenantId, race.id, now, 2),
      ])
    }
    await placement('race-existing', base.branchId)
    const raced = await Promise.allSettled([placement('race-left', base.branchId), placement('race-right', 'customer-a2')])
    expect(raced.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const saved = await db.select({ id: orders.id }).from(orders).where(eq(orders.customerId, race.id))
    const events = await db.select({ id: orderEvents.orderId }).from(orderEvents).where(eq(orderEvents.actorId, race.id))
    expect(saved).toHaveLength(2)
    expect(events.map(row => row.id).sort()).toEqual(saved.map(row => row.id).sort())
    const counts = (results: typeof beforeCold) => results.map(row => row.rowsRead)
    process.stderr.write(`D1 customer rows_read cold=${JSON.stringify({ before: counts(beforeCold), indexOnly: counts(afterCold), optimized: counts(afterOptimized) })} analyzed=${JSON.stringify({ before: counts(beforeAnalyzed), after: counts(afterAnalyzed) })}\n`)
  }
  finally {
    await proxy.dispose()
  }
})
