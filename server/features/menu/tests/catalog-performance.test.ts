import { performance } from 'node:perf_hooks'
import { sql } from 'drizzle-orm'
import { afterEach, expect, it, vi } from 'vitest'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { insertPieces } from '#server/utils/batch'
import type { Db } from '#server/utils/batch'
import * as repo from '#server/features/menu/catalog.repository'
import { loadCatalog } from '#server/features/menu/catalog.service'
import { menuCategories, menuItems, menuItemVariations } from '#server/features/menu/menu.schema'

afterEach(() => vi.restoreAllMocks())

/** A migration-backed workload with two cafes; bypass business services only to seed test data. */
async function seedCatalog(db: Db, tenantId: string, count: number) {
  await ensureTenant(db, tenantId)
  await db.insert(menuCategories).values({ id: `${tenantId}-category`, tenantId, name: 'Coffee' })
  const items = Array.from({ length: count }, (_, i) => ({ id: `${tenantId}-item-${i}`, tenantId, categoryId: `${tenantId}-category`, name: `Coffee ${i}`, status: 'active' as const, sortOrder: i }))
  const variations = items.map(item => ({ id: `${item.id}-version`, tenantId, itemId: item.id, combinationKey: '', priceMinor: 250, status: 'active' as const }))
  const [firstItem, ...moreItems] = insertPieces(menuItems, items).map(piece => db.insert(menuItems).values(piece))
  const [firstVersion, ...moreVersions] = insertPieces(menuItemVariations, variations).map(piece => db.insert(menuItemVariations).values(piece))
  if (firstItem) await db.batch([firstItem, ...moreItems])
  if (firstVersion) await db.batch([firstVersion, ...moreVersions])
}

it('batches fresh catalog reads and restricts checkout relations to the requested cafe/items', async () => {
  const db = await createTestDb()
  await seedCatalog(db, 'a', 200)
  await seedCatalog(db, 'b', 200)
  const batch = vi.spyOn(db, 'batch')
  const full = await loadCatalog(db, 'a')
  expect(full.items).toHaveLength(200)
  expect(batch).toHaveBeenCalledTimes(1)
  const fullRows = await batch.mock.results[0]!.value
  batch.mockClear()
  const selected = await loadCatalog(db, 'a', ['a-item-0', 'a-item-1', 'b-item-0', 'a-item-0', ...Array.from({ length: 110 }, (_, i) => `missing-${i}`)])
  expect(selected.items).toEqual(full.items.slice(0, 2))
  expect(batch).toHaveBeenCalledTimes(1)
  const selectedRows = await batch.mock.results[0]!.value
  expect(selectedRows[2]).toHaveLength(2)
  expect(selectedRows[4]).toHaveLength(2)
  expect(selectedRows.flat().length).toBeLessThan(fullRows.flat().length)
  expect((await loadCatalog(db, 'a', ['b-item-0'])).items).toEqual([])
  expect((await loadCatalog(db, 'a', [])).items).toEqual([])
  await db.update(menuItemVariations).set({ priceMinor: 350 }).where(sql`${menuItemVariations.id} = 'a-item-0-version'`)
  expect((await loadCatalog(db, 'a', ['a-item-0'])).items[0]!.variations[0]!.priceMinor).toBe(350)
})

it('uses the tenant/status index inside option and modifier subqueries', async () => {
  const db = await createTestDb()
  for (const query of [repo.activeOptionValues(db, 'a'), repo.activeModifiers(db, 'a')]) {
    const built = query.toSQL()
    const parts = built.sql.split('?')
    let statement = sql.raw(parts[0]!)
    for (let i = 0; i < built.params.length; i++) statement = sql`${statement}${built.params[i]}${sql.raw(parts[i + 1]!)}`
    const plan = JSON.stringify(await db.all(sql`explain query plan ${statement}`))
    expect(plan).toContain('menu_items_tenant_status_idx')
    expect(plan).not.toContain('SCAN menu_items')
  }
})

it.runIf(Boolean(process.env.CATALOG_BENCH))('records local catalog workload measurements without asserting machine-dependent latency', async () => {
  const db = await createTestDb()
  await seedCatalog(db, 'a', 1000)
  await seedCatalog(db, 'b', 1000)
  for (const selected of [undefined, ['a-item-0', 'a-item-1']]) {
    const elapsed: number[] = []
    const batch = vi.spyOn(db, 'batch')
    for (let i = 0; i < 20; i++) {
      const started = performance.now()
      await loadCatalog(db, 'a', selected)
      elapsed.push(performance.now() - started)
    }
    const relations = await batch.mock.results.at(-1)!.value
    elapsed.sort((a, b) => a - b)
    console.info(JSON.stringify({ workload: selected ? 'two-item checkout' : 'full menu', cafes: 2, itemsPerCafe: 1000, samples: 20, catalogDatabaseCalls: batch.mock.calls.length / 20, relationRows: relations.flat().length, p50Ms: elapsed[10], p95Ms: elapsed[18] }))
    batch.mockRestore()
  }
})
