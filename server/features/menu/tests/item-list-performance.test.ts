import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { menuCategories, menuItems, menuItemVariations } from '#server/features/menu/menu.schema'
import { listItems } from '#server/features/menu/items.repository'

it('prices only the named cafe using its existing index, preserving sellable ranges and pagination', async () => {
  // The page and its total run in one batch (D194), which libsql doesn't pass to a query logger.
  const queries: { query: string, params: unknown[] }[] = []
  const db = await createTestDb()
  const batch = db.batch.bind(db)
  db.batch = ((items) => {
    for (const item of items) {
      const { sql: query, params } = (item as unknown as { toSQL: () => { sql: string, params: unknown[] } }).toSQL()
      queries.push({ query, params })
    }
    return batch(items)
  }) as typeof db.batch
  for (const tenantId of ['a', 'b']) {
    await ensureTenant(db, tenantId)
    await db.insert(menuCategories).values({ id: `${tenantId}-category`, tenantId, name: 'Coffee' })
    for (const [i, prices] of [[100, 300], [null, null], [200, 400]].entries()) {
      const itemId = `${tenantId}-item-${i}`
      await db.insert(menuItems).values({ id: itemId, tenantId, categoryId: `${tenantId}-category`, name: `Coffee ${i}`, sortOrder: i, status: 'active' })
      for (const [j, priceMinor] of prices.entries()) {
        await db.insert(menuItemVariations).values({ id: `${itemId}-version-${j}`, tenantId, itemId, combinationKey: String(j), priceMinor, status: i === 2 || priceMinor === null ? 'disabled' : 'active' })
      }
    }
  }
  queries.length = 0
  const first = await listItems(db, 'a', { page: 1, pageSize: 2 })
  expect(first.total).toBe(3)
  expect(first.rows.map(r => [r.id, r.priceMin, r.priceMax])).toEqual([['a-item-0', 100, 300], ['a-item-1', null, null]])
  const page = queries.find(q => q.query.includes('left join'))!
  const pieces = page.query.split('?')
  let statement = sql.raw(pieces[0]!)
  for (let i = 0; i < page.params.length; i++) statement = sql`${statement}${page.params[i]}${sql.raw(pieces[i + 1]!)}`
  const plan = JSON.stringify(await db.all(sql`explain query plan ${statement}`))
  expect(plan).toContain('SEARCH menu_item_variations USING INDEX menu_item_variations_tenant_id_unique (tenant_id=?)')
  expect(plan).not.toContain('SCAN menu_item_variations')
  expect(page.params.filter(p => p === 'a')).toHaveLength(2)
  expect((await listItems(db, 'a', { page: 2, pageSize: 2 })).rows.map(r => [r.id, r.priceMin, r.priceMax])).toEqual([['a-item-2', null, null]])
  expect((await listItems(db, 'b', { page: 1, pageSize: 2 })).rows.map(r => r.id)).toEqual(['b-item-0', 'b-item-1'])
})
