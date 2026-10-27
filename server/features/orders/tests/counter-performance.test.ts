import { eq } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import { createTestDb, createUser, insertBranch } from '#server/tests/support/db'
import { insertPieces } from '#server/utils/batch'
import { listCounterQueue } from '#server/features/orders/counter.service'
import { counterContext, counterQueueRows } from '#server/features/orders/orders.repository'
import { bakongTokens, counterPayments, exchangeRates, khqrSettings, orderLines, orders } from '#server/features/orders/orders.schema'

afterEach(() => vi.restoreAllMocks())
const NOW = new Date('2026-10-14T05:00:00Z')
const actor = { tenantId: 'a', branchId: 'a-main', userId: '', role: 'member' as const, branchRole: 'staff' as const }

async function fixture() {
  const queries: string[] = []
  const db = await createTestDb({ logger: { logQuery: query => queries.push(query) } })
  const u = await createUser(db, 'cashier@example.com', 'Cashier')
  for (const [id, tenantId] of [['a-main', 'a'], ['a-other', 'a'], ['b-main', 'b']] as const) {
    await insertBranch(db, { id, tenantId, name: id, timezone: 'Asia/Phnom_Penh' })
  }
  const add = async (id: string, branchId: string, tenantId: string, status: 'preparing' | 'completed' | 'awaiting_payment', due = new Date(NOW.getTime() + 60000), businessDate = '2026-10-14') => {
    await db.insert(orders).values({ id, tenantId, branchId, customerId: u.id, businessDate, pickupNumber: id === 'other' ? 2 : 1, orderType: 'pickup', subtotalMinor: 100, totalMinor: 100, placedAt: NOW, paymentDueAt: due, status })
    await db.insert(orderLines).values({ tenantId, orderId: id, position: 1, itemId: 'item', variationId: 'variation', itemName: `${id} second`, detail: '', modifiers: [], unitPriceMinor: 50, quantity: 1, totalMinor: 50 })
    await db.insert(orderLines).values({ tenantId, orderId: id, position: 0, itemId: 'item', variationId: 'variation', itemName: `${id} first`, detail: '', modifiers: [], unitPriceMinor: 50, quantity: 1, totalMinor: 50 })
  }
  await add('own', 'a-main', 'a', 'awaiting_payment')
  await add('other', 'a-other', 'a', 'preparing')
  await add('foreign', 'b-main', 'b', 'preparing')
  queries.length = 0
  return { db, queries, u, actor: { ...actor, userId: u.id }, add }
}

it('uses two database calls/five SQL reads per fresh poll, independent of queue ID count', async () => {
  const { db, queries, u, actor } = await fixture()
  const queue = Array.from({ length: 120 }, (_, i) => ({ id: `queue-${String(i).padStart(3, '0')}`, tenantId: 'a', branchId: 'a-main', customerId: u.id, businessDate: '2026-10-14', pickupNumber: i + 2, orderType: 'pickup' as const, subtotalMinor: 100, totalMinor: 100, placedAt: NOW, paymentDueAt: NOW, status: 'preparing' as const }))
  for (const piece of insertPieces(orders, queue)) await db.insert(orders).values(piece)
  const lines = queue.map(o => ({ tenantId: 'a', orderId: o.id, position: 0, itemId: 'item', variationId: 'variation', itemName: o.id, detail: '', modifiers: [], unitPriceMinor: 100, quantity: 1, totalMinor: 100 }))
  for (const piece of insertPieces(orderLines, lines)) await db.insert(orderLines).values(piece)
  queries.length = 0
  const batch = vi.spyOn(db, 'batch')
  const first = await listCounterQueue(db, actor, NOW)
  expect(first.orders).toHaveLength(121)
  expect(first.orders.find(o => o.id === 'own')!.lines.map(l => l.itemName)).toEqual(['own first', 'own second'])
  expect(first.orders.every(o => o.id !== 'other' && o.id !== 'foreign')).toBe(true)
  expect(batch).toHaveBeenCalledTimes(1)
  expect(batch.mock.calls[0]![0]).toHaveLength(4)
  expect(queries).toHaveLength(1) // libsql logs the independent context read, not its batch's four statements.
  expect((await listCounterQueue(db, actor, NOW)).orders).toEqual(first.orders)
  expect(batch).toHaveBeenCalledTimes(2)
  expect(queries).toHaveLength(2)
  await expect(listCounterQueue(db, { ...actor, tenantId: 'b' }, NOW)).rejects.toMatchObject({ statusCode: 404 })
})

it('reads fresh rates, KHQR and token presence, payment/status changes and deadline expiry', async () => {
  const { db, actor, u } = await fixture()
  expect(await listCounterQueue(db, actor, NOW)).toMatchObject({ khrRate: null, khqr: null, finishedToday: 0 })
  await db.insert(exchangeRates).values({ tenantId: 'b', currency: 'KHR', perUsd: 9999, effectiveFrom: NOW, setBy: u.id })
  await db.insert(khqrSettings).values({ tenantId: 'b', enabled: true, currencies: 'KHR', accountId: 'b@bank', merchantName: 'B', merchantCity: 'City', updatedBy: u.id, updatedAt: NOW })
  await db.insert(bakongTokens).values({ tenantId: 'b', sealed: 'foreign-sealed-value', updatedBy: u.id, updatedAt: NOW })
  expect(await listCounterQueue(db, actor, NOW)).toMatchObject({ khrRate: null, khqr: null })
  await db.insert(exchangeRates).values({ tenantId: 'a', currency: 'KHR', perUsd: 4100, effectiveFrom: NOW, setBy: u.id })
  await db.insert(exchangeRates).values({ tenantId: 'a', currency: 'KHR', perUsd: 4200, effectiveFrom: new Date(NOW.getTime() + 30000), setBy: u.id })
  await db.insert(khqrSettings).values({ tenantId: 'a', enabled: true, currencies: 'USD,KHR', accountId: 'a@bank', merchantName: 'A', merchantCity: 'City', updatedBy: u.id, updatedAt: NOW })
  expect(await listCounterQueue(db, actor, NOW)).toMatchObject({ khrRate: { khrPerUsd: 4100, setBy: { name: 'Cashier' } }, khqr: { currencies: ['USD', 'KHR'], automaticCheck: false } })
  await db.insert(bakongTokens).values({ tenantId: 'a', sealed: 'secret-never-selected', updatedBy: u.id, updatedAt: NOW })
  expect((await listCounterQueue(db, actor, NOW)).khqr?.automaticCheck).toBe(true)
  expect(JSON.stringify(await listCounterQueue(db, actor, NOW))).not.toContain('secret-never-selected')
  await db.delete(bakongTokens).where(eq(bakongTokens.tenantId, 'a'))
  expect((await listCounterQueue(db, actor, NOW)).khqr?.automaticCheck).toBe(false)
  const later = new Date(NOW.getTime() + 60000)
  expect(await listCounterQueue(db, actor, later)).toMatchObject({ orders: [], khrRate: { khrPerUsd: 4200 } })
  await db.update(orders).set({ status: 'preparing', version: 2, paidAt: later }).where(eq(orders.id, 'own'))
  await db.insert(counterPayments).values({ tenantId: 'a', branchId: 'a-main', orderId: 'own', method: 'cash_usd', amountMinor: 100, collectedBy: u.id, collectedAt: later })
  expect((await listCounterQueue(db, actor, later)).orders[0]).toMatchObject({ id: 'own', status: 'preparing', version: 2, payment: { amountMinor: 100, collectedBy: { name: 'Cashier' } } })
  await db.update(orders).set({ status: 'completed', version: 3, completedAt: later }).where(eq(orders.id, 'own'))
  await db.update(khqrSettings).set({ enabled: false }).where(eq(khqrSettings.tenantId, 'a'))
  expect(await listCounterQueue(db, actor, later)).toMatchObject({ orders: [], khqr: null, finishedToday: 1 })
})

it('counts finished orders in the branch local business day and rejects a foreign branch context', async () => {
  const { db, actor, add } = await fixture()
  const before = new Date('2026-10-13T20:59:59Z') // 03:59:59 at the branch, still October 13.
  await add('finished-before', 'a-main', 'a', 'completed', NOW, '2026-10-13')
  await add('finished-after', 'a-other', 'a', 'completed', NOW, '2026-10-13')
  expect((await listCounterQueue(db, actor, before)).finishedToday).toBe(1)
  expect((await listCounterQueue(db, actor, new Date(before.getTime() + 1000))).finishedToday).toBe(0)
  expect(await counterContext(db, 'b', 'a-main', NOW)).toBeUndefined()
  expect(await counterQueueRows(db, 'b', 'a-main', '2026-10-14', NOW)).toMatchObject({ rows: [], lines: [], payments: [], finishedToday: 0 })
})

it('seeks active statuses instead of reading a branch history on every queue poll', async () => {
  const { db, u } = await fixture()
  const history = Array.from({ length: 2000 }, (_, i) => ({ id: `history-${i}`, tenantId: 'a', branchId: 'a-main', customerId: u.id, businessDate: '2026-10-13', pickupNumber: i + 1, orderType: 'pickup' as const, subtotalMinor: 100, totalMinor: 100, placedAt: NOW, paymentDueAt: NOW, status: 'completed' as const }))
  for (const piece of insertPieces(orders, history)) await db.insert(orders).values(piece)
  const reads: { sql: string, params: unknown[] }[] = []
  const batch = db.batch.bind(db)
  vi.spyOn(db, 'batch').mockImplementation((items) => {
    for (const item of items) reads.push((item as unknown as { toSQL: () => { sql: string, params: unknown[] } }).toSQL())
    return batch(items)
  })
  const client = (db as unknown as { $client: { execute: (statement: { sql: string, args: unknown[] } | string) => Promise<{ rows: Record<string, unknown>[] }> } }).$client
  for (const analyze of [false, true]) {
    if (analyze) await client.execute('ANALYZE')
    reads.length = 0
    expect((await counterQueueRows(db, 'a', 'a-main', '2026-10-14', NOW)).rows.map(row => row.id)).toEqual(['own'])
    // The queue, its lines and its payments all repeat the active-order predicate.
    for (const read of reads.slice(0, 3)) {
      const plan = (await client.execute({ sql: `EXPLAIN QUERY PLAN ${read.sql}`, args: read.params })).rows.map(row => String(row.detail))
      expect(plan.some(detail => detail.includes('orders_active_queue_idx') && detail.includes('tenant_id=? AND branch_id=?')), plan.join(' | ')).toBe(true)
    }
  }
})

it('keeps deadline boundaries, old preparing/ready orders and stable order when history is excluded', async () => {
  const { db, u } = await fixture()
  const statuses = ['awaiting_payment', 'awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled'] as const
  for (const [i, status] of statuses.entries()) {
    await db.insert(orders).values({
      id: `boundary-${i}`, tenantId: 'a', branchId: 'a-main', customerId: u.id,
      businessDate: '2026-10-13', pickupNumber: i + 1, orderType: 'pickup',
      subtotalMinor: 100, totalMinor: 100, placedAt: new Date(NOW.getTime() - 1),
      paymentDueAt: new Date(NOW.getTime() + (i === 1 ? 1 : 0)), status,
    })
  }
  const queue = await counterQueueRows(db, 'a', 'a-main', '2026-10-14', NOW)
  expect(queue.rows.map(row => row.id)).toEqual(['boundary-1', 'boundary-2', 'boundary-3', 'own'])
  expect(queue.finishedToday).toBe(0)
  expect((await counterQueueRows(db, 'a', 'a-main', '2026-10-14', new Date(NOW.getTime() + 1))).rows.map(row => row.id)).toEqual(['boundary-2', 'boundary-3', 'own'])
})
