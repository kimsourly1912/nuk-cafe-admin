import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/d1'
import { expect, it, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Db } from '#server/utils/batch'
import { chunk, insertPieces } from '#server/utils/batch'
import { createUser, insertBranch, migrationFiles } from '#server/tests/support/db'
import { counterQueueRows } from '#server/features/orders/orders.repository'
import { orders } from '#server/features/orders/orders.schema'

it('reduces active queue reads on local D1 without changing the snapshot', { tags: ['slow'] }, async () => {
  const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../../../tests/support/d1-wrangler.json', import.meta.url)), persist: false })
  const d1 = proxy.env.DB as {
    batch: (statements: unknown[]) => Promise<unknown>
    prepare: (sql: string) => {
      bind: (...params: unknown[]) => { all: () => Promise<{ results: unknown[], meta: { rows_read: number } }> }
      run: () => Promise<unknown>
    }
  }
  try {
    for (const file of migrationFiles()) {
      const source = readFileSync(fileURLToPath(new URL(`../../../db/migrations/sqlite/${file}`, import.meta.url)), 'utf8')
      await d1.batch(source.split('--> statement-breakpoint').filter(statement => statement.trim()).map(statement => d1.prepare(statement)))
    }
    const db = drizzle(d1 as never, { casing: 'snake_case' }) as unknown as Db
    const person = await createUser(db, 'queue@example.com', 'Customer')
    await insertBranch(db, { id: 'queue-a', tenantId: 'queue-a', name: 'A', timezone: 'Asia/Phnom_Penh' })
    await insertBranch(db, { id: 'queue-b', tenantId: 'queue-b', name: 'B', timezone: 'Asia/Phnom_Penh' })
    const now = new Date('2026-10-27T05:00:00Z')
    const records = Array.from({ length: 2000 }, (_, i) => ({
      id: `history-${i}`, tenantId: 'queue-a', branchId: 'queue-a', customerId: person.id,
      businessDate: '2026-10-26', pickupNumber: i + 1, orderType: 'pickup' as const,
      subtotalMinor: 100, totalMinor: 100, placedAt: now, paymentDueAt: now, status: 'completed' as const,
    }))
    const inserts = insertPieces(orders, records).map(piece => db.insert(orders).values(piece))
    for (const [first, ...rest] of chunk(inserts, 50)) if (first) await db.batch([first, ...rest])
    for (const [i, status] of (['awaiting_payment', 'preparing', 'ready', 'cancelled', 'completed'] as const).entries()) {
      await db.insert(orders).values({ ...records[0]!, id: `own-${status}`, pickupNumber: i + 1, businessDate: '2026-10-27', paymentDueAt: new Date(now.getTime() + 1), status })
      await db.insert(orders).values({ ...records[0]!, id: `other-${status}`, tenantId: 'queue-b', branchId: 'queue-b', pickupNumber: i + 1, status })
    }
    const reads: { sql: string, params: unknown[] }[] = []
    const batch = db.batch.bind(db)
    vi.spyOn(db, 'batch').mockImplementation((items) => {
      for (const item of items) reads.push((item as unknown as { toSQL: () => { sql: string, params: unknown[] } }).toSQL())
      return batch(items)
    })
    const snapshot = await counterQueueRows(db, 'queue-a', 'queue-a', '2026-10-27', now)
    expect(snapshot.rows.map(row => row.id)).toEqual(['own-awaiting_payment', 'own-preparing', 'own-ready'])
    expect(snapshot.finishedToday).toBe(2)
    expect((await counterQueueRows(db, 'queue-b', 'queue-a', '2026-10-27', now)).rows).toEqual([])
    const activeReads = reads.slice(0, 3)
    const measure = async () => {
      const counts: number[] = []
      for (const read of activeReads) {
        const plan = await d1.prepare(`EXPLAIN QUERY PLAN ${read.sql}`).bind(...read.params).all()
        const result = await d1.prepare(read.sql).bind(...read.params).all()
        counts.push(result.meta.rows_read)
        expect(plan.results.some(row => String((row as { detail: string }).detail).includes('orders_active_queue_idx'))).toBe(true)
      }
      return counts
    }
    const indexed = await measure()
    const legacyReads = activeReads.map(read => ({
      sql: read.sql.replace(
        `"orders"."status" in ('awaiting_payment', 'preparing', 'ready') and ("orders"."status" <> ? or "orders"."payment_due_at" > ?)`,
        `(("orders"."status" = ? and "orders"."payment_due_at" > ?) or "orders"."status" in (?, ?))`,
      ),
      params: [...read.params, 'preparing', 'ready'],
    }))
    const measureLegacy = async () => {
      const counts: number[] = []
      for (const [i, legacy] of legacyReads.entries()) {
        expect(legacy.sql).not.toBe(activeReads[i]!.sql)
        const result = await d1.prepare(legacy.sql).bind(...legacy.params).all()
        expect(result.results).toEqual((await d1.prepare(activeReads[i]!.sql).bind(...activeReads[i]!.params).all()).results)
        counts.push(result.meta.rows_read)
      }
      return counts
    }
    await d1.prepare('DROP INDEX orders_active_queue_idx').run()
    const before = await measureLegacy()
    const migration = readFileSync(fileURLToPath(new URL('../../../db/migrations/sqlite/0049_orders_active_queue.sql', import.meta.url)), 'utf8')
    await d1.prepare(migration).run()
    await d1.prepare('ANALYZE').run()
    const analyzed = await measure()
    expect(analyzed.every(rows => rows < 50)).toBe(true)
    await d1.prepare('DROP INDEX orders_active_queue_idx').run()
    const beforeAnalyzed = await measureLegacy()
    for (const [i, rows] of indexed.entries()) expect(rows).toBeLessThan(before[i]! / 10)
    expect(await counterQueueRows(db, 'queue-a', 'queue-a', '2026-10-27', now)).toEqual(snapshot)
    process.stderr.write(`D1 queue rows_read before=${JSON.stringify(before)} after=${JSON.stringify(indexed)} before_analyzed=${JSON.stringify(beforeAnalyzed)} after_analyzed=${JSON.stringify(analyzed)}\n`)
  }
  finally {
    vi.restoreAllMocks()
    await proxy.dispose()
  }
})
