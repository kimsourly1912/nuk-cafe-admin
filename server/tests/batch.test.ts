import { createClient } from '@libsql/client'
import { eq, sql } from 'drizzle-orm'
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core'
import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/libsql'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '#server/utils/batch'
import { isForeignKeyError, isStaleWrite, isUniqueViolation, requireCount, requireOneChange, runBatch } from '#server/utils/batch'
import { versionConflict } from '#server/utils/errors'
import { catalogRows, itemModifierGroups } from '#server/features/menu/catalog.repository'
import { listItems } from '#server/features/menu/items.repository'
import { linksOf } from '#server/features/menu/promotions.repository'
import * as repo from '#server/features/notifications/notifications.repository'
import { counterContext, counterQueueRows } from '#server/features/orders/orders.repository'
import { orderHistory } from '#server/features/orders/reports.repository'
import type { ItemListQuery } from '#shared/contracts/menu-items'
import type { OrderHistoryQuery } from '#shared/contracts/reports'

let db: Db
beforeEach(async () => {
  const client = createClient({ url: ':memory:' })
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('create table things (id text primary key, name text not null, version integer not null)')
  await client.execute('create table notes (id text primary key, thing_id text not null references things(id), text text not null unique)')
  await client.execute(`insert into things values ('a', 'A', 1)`)
  db = drizzle({ client, casing: 'snake_case' })
})

const names = async () => (await db.all<{ name: string }>(sql`select name from things order by id`)).map(r => r.name)
const notes = async () => (await db.all<{ text: string }>(sql`select text from notes`)).map(r => r.text)
const update = (version: number, name: string) => db.run(sql`update things set name = ${name}, version = version + 1 where id = 'a' and version = ${version}`)
const addNote = (text: string) => db.run(sql`insert into notes values (${text}, 'a', ${text})`)

describe('requireOneChange', () => {
  it('lets the batch apply when the conditional update matched', async () => {
    await runBatch(db, [update(1, 'B'), requireOneChange(db), addNote('changed')], () => versionConflict('The thing'))
    expect(await names()).toEqual(['B'])
    expect(await notes()).toEqual(['changed'])
  })

  it('rolls back everything, before and after it, when the update matched nothing', async () => {
    const run = runBatch(db, [addNote('before'), update(7, 'B'), requireOneChange(db), addNote('after')], () => versionConflict('The thing'))
    await expect(run).rejects.toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
    expect(await names()).toEqual(['A'])
    expect(await notes()).toEqual([])
  })
})

describe('requireCount', () => {
  it('aborts the batch when the count differs', async () => {
    const count = sql`select count(*) from things`
    await runBatch(db, [requireCount(db, count, 1), addNote('ok')], () => new Error('stale'))
    await expect(runBatch(db, [requireCount(db, count, 2), addNote('no')], () => new Error('stale'))).rejects.toThrow('stale')
    expect(await notes()).toEqual(['ok'])
  })
})

describe('error classification', () => {
  it('recognizes guard, foreign key and unique failures', async () => {
    const stale = await db.batch([update(9, 'x'), requireOneChange(db)]).catch(e => e)
    expect(isStaleWrite(stale)).toBe(true)
    const fk = await db.run(sql`insert into notes values ('n', 'missing', 'n')`).catch(e => e)
    expect(isForeignKeyError(fk)).toBe(true)
    await addNote('dup')
    const unique = await db.run(sql`insert into notes values ('n2', 'a', 'dup')`).catch(e => e)
    expect(isUniqueViolation(unique)).toBe(true)
    expect(isStaleWrite(fk)).toBe(false)
  })

  it('passes other errors through runBatch unchanged', async () => {
    await expect(runBatch(db, [db.run(sql`insert into notes values ('n', 'missing', 'n')`)], () => versionConflict('x')))
      .rejects.toSatisfy((e: unknown) => isForeignKeyError(e))
  })
})

describe('on D1', () => {
  /**
   * Drizzle's D1 driver against a stand-in D1 client that records what it's asked to run. The real
   * D1 answered the old raw-SQL guards with "Cannot read properties of undefined (reading 'bind')"
   * as soon as a guard had a bound parameter (staging, D53); libsql never showed it.
   */
  function fakeD1(batchValues?: (unknown[] | undefined)[]) {
    const bound: { sql: string, params: unknown[] }[] = []
    const statement = (text: string) => ({
      bind: (...params: unknown[]) => {
        const entry = { sql: text, params }
        bound.push(entry)
        return { ...entry, all: async () => ({ results: [] }), raw: async () => [], run: async () => ({ results: [] }), first: async () => null }
      },
    })
    const client = {
      prepare: (text: string) => statement(text),
      batch: async (statements: { sql: string }[]) => statements.map((statement, i) => {
        const values = batchValues?.[i]
        // D1 batch objects use SQL column names, not Drizzle's property names. Duplicate names
        // collapse, unlike individual .raw() reads. These fixtures contain simple selected columns.
        const columns = values ? statement.sql.slice(7, statement.sql.indexOf(' from ')).split(', ').map(column => column.match(/"([^"]+)"$/)?.[1] ?? column) : []
        return { results: values ? [Object.fromEntries(columns.map((column, index) => [column, values[index]]))] : [], success: true, meta: {} }
      }),
    }
    return { db: drizzleD1(client as never) as unknown as Db, bound }
  }

  const things = sqliteTable('t', { v: integer() })

  it('batches every guard, with and without bound parameters', async () => {
    const { db: d1, bound } = fakeD1()
    await d1.batch([
      d1.update(things).set({ v: 1 }).where(eq(things.v, 0)),
      requireOneChange(d1),
      requireCount(d1, sql`select count(*) from t where kind = ${'admin'}`, 1),
    ])
    expect(bound.map(b => b.params)).toEqual([[1, 0], [], ['admin', 1]])
    expect(bound[2]!.sql).toContain('json(\'stale write\')')
  })

  it('executes catalog selections through the actual D1 driver batch adapter', async () => {
    const { db: d1, bound } = fakeD1()
    const rows = await catalogRows(d1, 'cafe-a', ['item-1', 'item-2'])
    expect(rows).toHaveLength(12)
    expect(bound).toHaveLength(12)
    expect(bound.every(statement => statement.sql.startsWith('select ') && statement.params.includes('cafe-a') && statement.params.length <= 100)).toBe(true)
    expect(bound.some(statement => statement.params.includes('["item-1","item-2"]'))).toBe(true)
  })

  it('executes fresh counter context and all four queue selections through the actual D1 adapter', async () => {
    const { db: d1, bound } = fakeD1()
    const now = new Date('2026-10-14T05:00:00Z')
    expect(await counterContext(d1, 'cafe-a', 'branch-a', now)).toBeUndefined()
    expect(await counterQueueRows(d1, 'cafe-a', 'branch-a', '2026-10-14', now)).toEqual({ rows: [], lines: [], payments: [], finishedToday: 0 })
    expect(bound).toHaveLength(5)
    expect(bound.every(statement => statement.params.includes('cafe-a') && statement.params.includes('branch-a') && statement.params.length <= 100)).toBe(true)
    expect(bound[0]!.sql).toContain('exists (select 1 from "bakong_tokens"')
    expect(bound[0]!.sql).not.toContain('"sealed"')
    expect(bound[2]!.sql).toContain('in (select "id" from "orders"')
    expect(bound[3]!.sql).toContain('in (select "id" from "orders"')
    expect(bound[4]!.params).toContain('2026-10-14')
  })

  it('keeps branch and customer names distinct in D1 batch objects without shifting timestamps', async () => {
    const now = new Date('2026-10-14T05:00:00Z')
    const { db: d1 } = fakeD1([
      ['order-a', 'cafe-a', 'branch-a', 'Branch A', 'customer-a', 'Customer A', 1, '2026-10-14', 'preparing', 'pickup', null, 100, 100, now.getTime(), now.getTime() + 60000, now.getTime(), null, null, null, 2],
      undefined, undefined, [0],
    ])
    const result = await counterQueueRows(d1, 'cafe-a', 'branch-a', '2026-10-14', now)
    expect(result.rows).toEqual([expect.objectContaining({ branchName: 'Branch A', customerName: 'Customer A', placedAt: now, paymentDueAt: new Date(now.getTime() + 60000), paidAt: now, version: 2 })])
  })

  it('keeps the order id apart from its payment id in an order history page read in one D1 batch (D170, D194)', async () => {
    const placed = new Date('2026-10-14T05:00:00Z')
    const { db: d1 } = fakeD1([
      ['order-a', 7, '2026-10-14', placed.getTime(), 'pickup', null, 'completed', 875, 'cash_usd', 'payment-a', null],
      [1],
    ])
    const query = { branchId: 'branch-a', from: '2026-10-14', to: '2026-10-14', page: 1, pageSize: 20, sort: 'placed', direction: 'desc' } as OrderHistoryQuery
    const page = await orderHistory(d1, 'cafe-a', query)
    expect(page).toEqual({ total: 1, rows: [expect.objectContaining({ id: 'order-a', pickupNumber: 7, paymentId: 'payment-a', placedAt: placed })] })
  })

  it('executes the customer ready message subscribe, claim, completion and due query through the actual D1 adapter', async () => {
    const { db: d1, bound } = fakeD1()
    const now = new Date('2026-10-14T05:00:00Z')
    await d1.batch([repo.subscribeOrderReadyAlertStatement(d1, 'order-a', 'hash', 'chat-1', 'sub-1', now), requireOneChange(d1)])
    const claim = await repo.claimOrderReady(d1, 'cafe-a', 'order-a', now, new Date(now.getTime() + 120_000))
    expect(claim).toBeUndefined()
    const fenced = { tenantId: 'cafe-a', orderId: 'order-a', chatId: 'chat-1', subscriptionId: 'sub-1', claimToken: 'token-1' } as repo.OrderReadyClaim
    expect(await repo.completeOrderReady(d1, fenced, now)).toBe(false)
    expect(await repo.dueOrderReadyAlerts(d1, now, 5)).toEqual([])
    expect(bound.every(statement => statement.params.length <= 100)).toBe(true)
    const complete = bound.find(statement => statement.sql.startsWith('update "order_ready_alerts" set "chatId" = ?, "notifiedAt"'))!
    // The claim's token and subscription are bound values, never inlined.
    expect(complete.params).toEqual(expect.arrayContaining(['cafe-a', 'order-a', 'sub-1', 'token-1']))
    expect(bound.find(statement => statement.sql.includes('"order_ready_alerts"') && statement.sql.includes('"claimUntil" <= ?'))).toBeDefined()
  })

  it('keeps item override and default add-on rules distinct in the catalog batch', async () => {
    const { db: d1 } = fakeD1([['item-a', 'group-a', 'Extras', 1, 0, 2, 1, 3]])
    const [rows] = await d1.batch([itemModifierGroups(d1, 'cafe-a')])
    expect(rows).toEqual([{ itemId: 'item-a', groupId: 'group-a', name: 'Extras', rulesOverridden: true, ownMin: 0, ownMax: 2, groupMin: 1, groupMax: 3 }])
  })

  it('keeps the category name apart from the item name in a menu item page read in one D1 batch (D170, D194)', async () => {
    const created = new Date('2026-10-14T05:00:00Z')
    const { db: d1 } = fakeD1([
      ['item-a', 'category-a', 'Iced Latte', '', null, 'active', 1, 3, created.getTime(), created.getTime(), 'Coffee', 875, 950],
      [1],
    ])
    const page = await listItems(d1, 'cafe-a', { page: 1, pageSize: 20 } as ItemListQuery)
    expect(page).toEqual({ total: 1, rows: [expect.objectContaining({ id: 'item-a', name: 'Iced Latte', categoryName: 'Coffee', priceMin: 875, priceMax: 950, createdAt: created })] })
  })

  it('reads a promotion\'s items, categories and branches in one D1 batch, each with its own name', async () => {
    const { db: d1, bound } = fakeD1([['promo-a', 'item-a', 'Iced Latte', 'active'], ['promo-a', 'category-a', 'Coffee', 'active'], ['promo-a', 'branch-a', 'Main']])
    const links = await linksOf(d1, 'cafe-a', ['promo-a'])
    expect(links.items.get('promo-a')).toEqual([{ id: 'item-a', name: 'Iced Latte', status: 'active' }])
    expect(links.categories.get('promo-a')).toEqual([{ id: 'category-a', name: 'Coffee', status: 'active' }])
    expect(links.branches.get('promo-a')).toEqual([{ id: 'branch-a', name: 'Main' }])
    expect(bound).toHaveLength(3)
    expect(bound.every(statement => statement.params.includes('cafe-a'))).toBe(true)
  })
})
