import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor, BranchActor } from '#server/features/identity'
import type { Db } from '#server/utils/batch'
import { updateBranchSettings } from '#server/features/branches'
import { createCategory, createItem, publishItem } from '#server/features/menu'
import { createTestDb, createUser, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { interleavedRead } from '#server/tests/support/interleave'
import { getOrder, listMyOrders, placeOrder } from '#server/features/orders/orders.service'
import { cancelOrderAtCounter, getCounterOrder, getCounterOrderHistory, payOrder } from '#server/features/orders/counter.service'
import { itemSalesExport, itemSalesReport, orderHistoryDetail, reportMessage, reportSummary } from '#server/features/orders/reports.service'
import { itemSalesQuerySchema, reportPeriodQuerySchema } from '#shared/contracts/reports'
import { parseInput } from '#server/utils/validation'
import { newId } from '#server/utils/ids'

let db: Db
let customer: Actor
let cashier: BranchActor
let orderId: string
const at = new Date('2026-09-28T05:00:00Z')
const paidAt = new Date(at.getTime() + 60_000)

beforeEach(async () => {
  db = await createTestDb()
  const owner: Actor = { tenantId: TEST_TENANT, userId: 'admin-1', role: 'owner' }
  const branchId = newId()
  await insertBranch(db, { id: branchId, name: 'Branch', timezone: 'Asia/Phnom_Penh' })
  await updateBranchSettings(db, owner, branchId, { version: 1, hours: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 })) })
  const category = await createCategory(db, owner, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, owner, { categoryId: category.id, name: 'Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 500, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const item = await publishItem(db, owner, draft.id, { version: draft.version })
  customer = { ...owner, role: 'customer', userId: (await createUser(db)).id }
  cashier = { ...owner, userId: (await createUser(db)).id, branchId, branchRole: 'manager' }
  orderId = (await placeOrder(db, customer, { branchId, tableToken: null, lines: [{ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, note: null }], expectedTotalMinor: 500 }, crypto.randomUUID(), at)).orderId
})

const pay = () => payOrder(db, cashier, orderId, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), paidAt)
const query = () => ({ branchId: cashier.branchId, from: '2026-09-28', to: '2026-09-28' })

describe('one response reads one database state', () => {
  it('does not duplicate an order across current and past lists during cancellation', async () => {
    const on = interleavedRead(db, sql => sql.includes('from "orders"'), async () => {
      await cancelOrderAtCounter(db, cashier, orderId, { version: 1, reason: 'other', note: null, returnMethod: null }, crypto.randomUUID(), paidAt)
    })
    const list = await listMyOrders(on, customer, { page: 1, pageSize: 20 })
    expect(list.inProgress.map(order => order.id)).toEqual([orderId])
    expect(list.past.items).toEqual([])
    expect(list.inProgress[0]?.itemCount).toBe(1)
  })

  for (const view of ['customer', 'counter', 'counter history', 'report detail'] as const) {
    it(`${view} does not mix an unpaid status with a later payment or event`, async () => {
      let changed = false
      const on = interleavedRead(db, sql => sql.includes('from "orders"'), async () => {
        await pay()
        changed = true
      })
      const read = view === 'customer'
        ? await getOrder(on, customer, orderId)
        : view === 'counter'
          ? await getCounterOrder(on, cashier, orderId)
          : view === 'counter history'
            ? (await getCounterOrderHistory(on, cashier, orderId)).order
            : await orderHistoryDetail(on, TEST_TENANT, orderId)
      expect(changed).toBe(true)
      expect(read.status).toBe('awaiting_payment')
      if (view === 'report detail') expect(read.payment).toMatchObject({ state: 'unpaid', method: null })
      else expect(read.payment).toBeNull()
      expect((await getOrder(db, customer, orderId)).status).toBe('preparing')
    })
  }

  it('summary sales, best sellers and queue counts agree during a new payment', async () => {
    const on = interleavedRead(db, sql => sql.includes('from "counter_payments"'), pay)
    const summary = await reportSummary(on, TEST_TENANT, parseInput(reportPeriodQuerySchema, query()), paidAt)
    expect(summary.paid).toMatchObject({ salesMinor: 0, orders: 0 })
    expect(summary.bestSellers).toEqual([])
    expect(summary.current).toMatchObject({ awaitingPayment: 1, preparing: 0 })
    expect((await reportSummary(db, TEST_TENANT, parseInput(reportPeriodQuerySchema, query()), paidAt)).paid.salesMinor).toBe(500)
  })

  for (const view of ['page', 'csv', 'telegram'] as const) {
    it(`item sales ${view} does not mix earlier collected totals with later refunds`, async () => {
      const on = interleavedRead(db, sql => sql.includes('from "order_lines"'), async () => {
        await pay()
        await cancelOrderAtCounter(db, cashier, orderId, { version: 2, reason: 'other', note: 'Returned', returnMethod: 'cash' }, crypto.randomUUID(), new Date(paidAt.getTime() + 60_000))
      })
      const input = parseInput(itemSalesQuerySchema, query())
      if (view === 'page') expect((await itemSalesReport(on, TEST_TENANT, input, paidAt)).items).toEqual([])
      if (view === 'csv') expect((await itemSalesExport(on, TEST_TENANT, input, paidAt)).csv).not.toContain('Latte')
      if (view === 'telegram') expect((await reportMessage(on, TEST_TENANT, { kind: 'items', query: query() }, { attachCsv: true }, paidAt)).csv?.csv).not.toContain('Latte')
    })
  }
})
