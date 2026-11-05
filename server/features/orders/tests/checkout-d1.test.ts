import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { PlatformProxy } from 'wrangler'
import type { Db } from '#server/utils/batch'
import type { Actor, BranchActor } from '#server/features/identity'
import { createCategory, createItem, publishItem, setSoldOut, updateItem } from '#server/features/menu'
import { captureCheckoutBranchGuard, createTable, pauseBranch, updateBranchSettings } from '#server/features/branches'
import { cancelOrderAtCounter, getCounterOrder, payOrder, setExchangeRate } from '#server/features/orders/counter.service'
import { createKhqrCharge, saveKhqrSettings } from '#server/features/orders/khqr.service'
import { reportSummary, orderHistoryDetail } from '#server/features/orders/reports.service'
import { interleaved } from '#server/tests/support/interleave'
import { getOrder, placeOrder } from '#server/features/orders/orders.service'
import { counterPayments, orderEvents, orderLines, orders } from '#server/features/orders/orders.schema'
import { auditEvents, idempotencyKeys, outboxMessages } from '#server/features/platform/platform.schema'
import { createUser, insertBranch, migrationFiles } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { newId } from '#server/utils/ids'

let proxy: PlatformProxy<Record<string, unknown>>
let db: Db
const noon = new Date('2026-09-28T05:00:00Z')
const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 }))

beforeAll(async () => {
  proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../../../tests/support/d1-wrangler.json', import.meta.url)), persist: false })
  const d1 = proxy.env.DB as { prepare: (query: string) => { run: () => Promise<unknown> } }
  for (const file of migrationFiles()) {
    const source = readFileSync(fileURLToPath(new URL(`../../../db/migrations/sqlite/${file}`, import.meta.url)), 'utf8')
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim()) await d1.prepare(statement).run()
    }
  }
  db = drizzle(d1 as never, { casing: 'snake_case' }) as unknown as Db
}, 60_000)
afterAll(async () => {
  await proxy?.dispose()
})

async function cafe() {
  const tenantId = newId()
  const owner: Actor = { userId: (await createUser(db)).id, tenantId, role: 'owner' }
  const branchId = newId()
  await insertBranch(db, { id: branchId, tenantId, name: 'Branch', timezone: 'Asia/Phnom_Penh' })
  await updateBranchSettings(db, owner, branchId, { version: 1, hours })
  const category = await createCategory(db, owner, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
  const draft = await createItem(db, owner, { categoryId: category.id, name: 'Coffee', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 250, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  const item = await publishItem(db, owner, draft.id, { version: draft.version })
  const customer: Actor = { userId: (await createUser(db)).id, tenantId, role: 'customer' }
  const staff: BranchActor = { ...owner, branchId, branchRole: 'manager' }
  const input = { branchId, tableToken: null, lines: [{ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, note: null }], expectedTotalMinor: 250 }
  return { owner, customer, staff, item, input }
}

function beforeCommit(work: () => Promise<unknown>): Db {
  const on = Object.create(db) as Db
  let pending = true
  on.batch = (async (statements: Parameters<Db['batch']>[0]) => {
    const first = statements[0] as unknown as { toSQL: () => { sql: string } }
    if (pending && first.toSQL().sql.startsWith('insert into "idempotency_keys"')) {
      pending = false
      await work()
    }
    return db.batch(statements)
  }) as unknown as Db['batch']
  return on
}

const counts = () => Promise.all([orders, orderLines, orderEvents, counterPayments, idempotencyKeys, auditEvents, outboxMessages].map(table => db.select({ count: sql<number>`count(*)` }).from(table)))

describe('checkout on local workerd/D1 with every migration', { tags: ['slow'] }, () => {
  for (const scenario of ['sold out', 'price', 'pause'] as const) {
    it(`rolls back checkout when ${scenario} commits after validation`, async () => {
      const c = await cafe()
      let after: unknown
      const on = beforeCommit(async () => {
        if (scenario === 'sold out') await setSoldOut(db, c.staff, { variationIds: [c.input.lines[0]!.variationId], soldOut: true })
        if (scenario === 'price') await updateItem(db, c.owner, c.item.id, { version: c.item.version, variations: [{ valueIds: [], priceMinor: 350, status: 'active' }] })
        if (scenario === 'pause') await pauseBranch(db, c.owner, c.input.branchId, { for: '15m', reason: null }, noon)
        after = await counts()
      })
      const code = scenario === 'price' ? 'PRICES_CHANGED' : scenario === 'pause' ? 'ORDERING_CLOSED' : 'ORDER_NOT_ORDERABLE'
      await expectApiError(() => placeOrder(on, c.customer, c.input, crypto.randomUUID(), noon), 409, code)
      expect(after).toBeDefined()
      expect(await counts()).toEqual(after)
    })
  }

  it('isolates cafe and branch snapshots while another cafe changes', async () => {
    const a = await cafe()
    const b = await cafe()
    const on = beforeCommit(async () => {
      await setSoldOut(db, b.staff, { variationIds: [b.input.lines[0]!.variationId], soldOut: true })
      await updateBranchSettings(db, b.owner, b.input.branchId, { version: 2, hours: [] })
      await createTable(db, b.owner, b.input.branchId, { label: 'Other cafe', area: null }, { secret: 'long-enough-test-secret', baseUrl: 'https://example.com' })
      await createCategory(db, b.owner, { name: 'Other category', description: '', parentId: null, availabilityRuleIds: [] })
    })
    const placing = placeOrder(on, a.customer, a.input, crypto.randomUUID(), noon)
    await expect(placing).resolves.toMatchObject({ replayed: false })
    const result = await placing
    expect((await getOrder(db, a.customer, result.orderId)).totalMinor).toBe(250)
    await expectApiError(() => placeOrder(db, a.customer, { ...a.input, branchId: b.input.branchId }, crypto.randomUUID(), noon), 404, 'NOT_FOUND')
  })

  it('the database-clock guard rolls back a request crossing a minute boundary', async () => {
    const c = await cafe()
    const before = await counts()
    const on = beforeCommit(() => new Promise(resolve => setTimeout(resolve, 30)))
    await expectApiError(() => placeOrder(on, c.customer, c.input, crypto.randomUUID(), new Date(noon.getTime() + 59_999)), 409, 'ORDER_NOT_ORDERABLE')
    expect(await counts()).toEqual(before)
  })

  it('a branch snapshot cannot validate a branch of another cafe', async () => {
    const a = await cafe()
    const b = await cafe()
    const foreign = await captureCheckoutBranchGuard(db, a.owner.tenantId, b.input.branchId)
    await expect(db.batch([foreign.guard])).rejects.toThrow()
    const own = await captureCheckoutBranchGuard(db, a.owner.tenantId, a.input.branchId)
    await db.batch([own.guard])
  })

  it('a database failure late in the batch rolls back everything and the key can be retried', async () => {
    const c = await cafe()
    const key = crypto.randomUUID()
    const d1 = proxy.env.DB as { prepare: (query: string) => { run: () => Promise<unknown> } }
    const before = await counts()
    // Generated UUID, never input; fail after order, lines and event have been inserted.
    await d1.prepare(`create trigger fail_checkout before insert on outbox_messages when new.tenant_id = '${c.owner.tenantId}' begin select raise(abort, 'test interruption'); end`).run()
    try {
      await expect(placeOrder(db, c.customer, c.input, key, noon)).rejects.toThrow()
      expect(await counts()).toEqual(before)
    }
    finally {
      await d1.prepare('drop trigger fail_checkout').run()
    }
    const result = await placeOrder(db, c.customer, c.input, key, noon)
    expect(result.replayed).toBe(false)
    expect((await getOrder(db, c.customer, result.orderId)).totalMinor).toBe(250)
  })

  it('a response lost after commit is recovered by the same key without another write', async () => {
    const c = await cafe()
    const key = crypto.randomUUID()
    const on = Object.create(db) as Db
    on.batch = (async (statements: Parameters<Db['batch']>[0]) => {
      const result = await db.batch(statements)
      const first = statements[0] as unknown as { toSQL: () => { sql: string } }
      if (first.toSQL().sql.startsWith('insert into "idempotency_keys"')) throw new Error('Simulated lost response after D1 commit')
      return result
    }) as unknown as Db['batch']
    await expect(placeOrder(on, c.customer, c.input, key, noon)).rejects.toThrow('Simulated lost response')
    const committed = await counts()
    const result = await placeOrder(db, c.customer, c.input, key, noon)
    expect(result.replayed).toBe(true)
    expect(await counts()).toEqual(committed)
  })

  it('commits the 30-line contract maximum and replays after a lost response', async () => {
    const c = await cafe()
    const input = { ...c.input, lines: Array.from({ length: 30 }, (_, i) => ({ ...c.input.lines[0]!, note: `Line ${i}` })), expectedTotalMinor: 7500 }
    const key = crypto.randomUUID()
    const result = await placeOrder(db, c.customer, input, key, noon)
    expect((await getOrder(db, c.customer, result.orderId)).lines).toHaveLength(30)
    await setSoldOut(db, c.staff, { variationIds: [c.input.lines[0]!.variationId], soldOut: true })
    expect(await placeOrder(db, c.customer, input, key, noon)).toEqual({ ...result, replayed: true })
  })

  it('holds two requests at their write batches: one order for the same key', async () => {
    const c = await cafe()
    const key = crypto.randomUUID()
    let arrived = 0
    let release!: () => void
    const meeting = new Promise<void>((resolve) => {
      release = resolve
    })
    const on = beforeCommit(async () => {
      if (++arrived === 2) release()
      await meeting
    })
    // One wrapper per request so each arrives at the actual commit boundary.
    const other = beforeCommit(async () => {
      if (++arrived === 2) release()
      await meeting
    })
    const results = await Promise.all([placeOrder(on, c.customer, c.input, key, noon), placeOrder(other, c.customer, c.input, key, noon)])
    expect(results[0]!.orderId).toBe(results[1]!.orderId)
    expect(results.map(r => r.replayed).sort()).toEqual([false, true])
  })
})

describe('payment and detail reliability on local workerd/D1', { tags: ['slow'] }, () => {
  it('rolls back cash payment if the current rate changes at commit, then safely retries', async () => {
    const c = await cafe()
    const id = (await placeOrder(db, c.customer, c.input, crypto.randomUUID(), noon)).orderId
    await setExchangeRate(db, c.owner, { khrPerUsd: 4100 }, noon)
    const key = crypto.randomUUID()
    let after: unknown
    const on = interleaved(db, async () => {
      await setExchangeRate(db, c.owner, { khrPerUsd: 4200 }, new Date(noon.getTime() + 1000))
      after = await counts()
    })
    await expectApiError(() => payOrder(on, c.staff, id, { version: 1, method: 'cash_khr', khrPerUsd: 4100 }, key, new Date(noon.getTime() + 60_000)), 409, 'EXCHANGE_RATE_CHANGED')
    expect(await counts()).toEqual(after)
    expect((await payOrder(db, c.staff, id, { version: 1, method: 'cash_khr', khrPerUsd: 4200 }, key, new Date(noon.getTime() + 60_000))).payment).toMatchObject({ khrPerUsd: 4200, amountMinor: 250 })
  })

  it('rolls back a cash payment that crosses the database deadline', async () => {
    const c = await cafe()
    const id = (await placeOrder(db, c.customer, c.input, crypto.randomUUID(), noon)).orderId
    const before = await counts()
    const on = interleaved(db, () => new Promise(resolve => setTimeout(resolve, 30)))
    await expectApiError(() => payOrder(on, c.staff, id, { version: 1, method: 'cash_usd' }, crypto.randomUUID(), new Date(noon.getTime() + 30 * 60_000 - 1)), 409, 'PAYMENT_EXPIRED')
    expect(await counts()).toEqual(before)
  })

  for (const reuse of [false, true]) {
    it(`refuses a cancelled order's ${reuse ? 'reused' : 'new'} QR at commit`, async () => {
      const c = await cafe()
      const id = (await placeOrder(db, c.customer, c.input, crypto.randomUUID(), noon)).orderId
      await saveKhqrSettings(db, c.owner, { version: 0, enabled: true, accountId: `cafe${c.owner.userId.slice(-8)}@aclb`, merchantName: 'Cafe', merchantCity: 'Phnom Penh', currencies: ['USD'] }, noon)
      if (reuse) await createKhqrCharge(db, c.staff, id, { currency: 'USD' }, noon)
      const on = interleaved(db, () => cancelOrderAtCounter(db, c.staff, id, { version: 1, reason: 'other', note: 'Changed', returnMethod: null }, crypto.randomUUID(), noon))
      await expectApiError(() => createKhqrCharge(on, c.staff, id, { currency: 'USD' }, noon), 409, 'ORDER_CHANGED')
      expect((await getOrder(db, c.customer, id)).status).toBe('cancelled')
    })
  }

  it('rate and receiving-setting guards isolate cafes and D1 detail columns keep their decoders', async () => {
    const a = await cafe()
    const b = await cafe()
    const settings = { version: 0, enabled: true, accountId: `cafe${a.owner.userId.slice(-8)}@aclb`, merchantName: 'Cafe', merchantCity: 'Phnom Penh', currencies: ['USD' as const] }
    await saveKhqrSettings(db, a.owner, settings, noon)
    await saveKhqrSettings(db, b.owner, settings, noon)
    await setExchangeRate(db, a.owner, { khrPerUsd: 4100 }, noon)
    const id = (await placeOrder(db, a.customer, a.input, crypto.randomUUID(), noon)).orderId
    const qrOn = interleaved(db, () => saveKhqrSettings(db, b.owner, { ...settings, version: 1, enabled: false }, noon))
    await createKhqrCharge(qrOn, a.staff, id, { currency: 'USD' }, noon)
    const payOn = interleaved(db, () => setExchangeRate(db, b.owner, { khrPerUsd: 5000 }, noon))
    await payOrder(payOn, a.staff, id, { version: 1, method: 'cash_khr', khrPerUsd: 4100 }, crypto.randomUUID(), noon)
    const detail = await orderHistoryDetail(db, a.owner.tenantId, id)
    expect(detail).toMatchObject({ branch: { id: a.input.branchId, name: 'Branch', timeZone: 'Asia/Phnom_Penh' }, status: 'preparing', payment: { state: 'paid', amountMinor: 250, khrPerUsd: 4100 } })
    expect(detail.timeline.map(event => event.toStatus)).toEqual(['awaiting_payment', 'preparing'])
    expect((await getCounterOrder(db, a.staff, id)).customer.name).toBe('Test User')
    const summary = await reportSummary(db, a.owner.tenantId, { branchId: a.input.branchId, from: '2026-09-28', to: '2026-09-28' }, noon)
    expect(summary.paid).toMatchObject({ salesMinor: 250, orders: 1 })
    expect(summary.bestSellers[0]).toMatchObject({ name: 'Coffee' })
    await expectApiError(() => getOrder(db, b.customer, id), 404, 'NOT_FOUND')
    await expectApiError(() => orderHistoryDetail(db, b.owner.tenantId, id), 404, 'NOT_FOUND')
  })
})
