import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SampleDataState, SampleMenuSize } from '#shared/contracts/sample-data'
import { createTable, getBranchSettings } from '#server/features/branches'
import type { QrConfig } from '#server/features/branches'
import type { Actor } from '#server/features/identity'
import { mediaAssets } from '#server/features/media/media.schema'
import { createCategory, createItem, listCategories, listItems, listSoldOut } from '#server/features/menu'
import { auditEvents } from '#server/features/platform/platform.schema'
import { loadSampleBranch, loadSampleMenuStep, resetSampleMenu } from '#server/features/sample-data/sample-data.service'
import { claimRun } from '#server/features/sample-data/sample-data.repository'
import { itemsForSize, SAMPLE_TABLES } from '#server/features/sample-data/sample-data.catalog'
import { createTestDb, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
let branchId: string
const admin: Actor = { userId: 'admin-1', tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }
const qr: QrConfig = { secret: 'test-secret', baseUrl: 'https://cafe.example' }
const ENV = 'Test'

beforeEach(async () => {
  db = await createTestDb()
  branchId = newId()
  await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh', status: 'active' })
})

/** Runs steps until the load finishes, like the page does; returns the last state and the step count. */
async function loadAll(size: SampleMenuSize) {
  let state: SampleDataState | undefined
  let steps = 0
  do {
    state = await loadSampleMenuStep(db, admin, { size }, ENV)
    steps++
    if (steps > 200) throw new Error('The load never finished')
  } while (!state.menu.run?.finished)
  return { state, steps }
}

async function itemNames() {
  const page = await listItems(db, TEST_TENANT, { page: 1, pageSize: 100, status: 'all' })
  const rest = page.totalPages > 1 ? (await listItems(db, TEST_TENANT, { page: 2, pageSize: 100, status: 'all' })).items : []
  return [...page.items, ...rest].map(i => i.name)
}

describe('the sample menu', () => {
  it('loads the standard menu in small steps, in the states of the brief', async () => {
    const { state, steps } = await loadAll('standard')
    expect(state.menu.counts).toMatchObject({ categories: 8, optionSets: 3, modifierGroups: 4, availabilityRules: 2, items: { active: 35, draft: 3, archived: 2 } })
    expect(state.menu.run).toMatchObject({ size: 'standard', finished: true })
    expect(state.menu.run!.stages.every(stage => stage.done === stage.total)).toBe(true)
    // At most two records per step (a Worker's query budget): 17 library records and 40 items.
    expect(steps).toBeGreaterThanOrEqual(Math.ceil((17 + 40) / 2))
    const soldOut = await listSoldOut(db, { ...admin, branchId })
    expect([...new Set(soldOut.variations.map(v => v.itemName))].sort()).toEqual(['Cheese Foam Cold Brew', 'Hojicha Latte'])
  })

  it('loads 12 items for Small and 150 for Large, names unique', async () => {
    await loadAll('small')
    expect((await itemNames()).length).toBe(12)
    expect(new Set(itemsForSize('large').map(i => i.name.toLowerCase())).size).toBe(150)
  })

  it('loads Large: 150 items, every generated one valid', async () => {
    const { state } = await loadAll('large')
    expect(state.menu.counts.items).toEqual({ active: 145, draft: 3, archived: 2 })
  }, 60_000)

  it('refuses to start on a menu that has data, and loads once', async () => {
    await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })
    await expectApiError(() => loadSampleMenuStep(db, admin, { size: 'small' }, ENV), 409, 'SAMPLE_MENU_NOT_EMPTY')
    await resetSampleMenu(db, admin, { put: async () => {}, del: async () => {} }, ENV)
    await loadAll('small')
    await expectApiError(() => loadSampleMenuStep(db, admin, { size: 'small' }, ENV), 409, 'SAMPLE_MENU_LOADED')
  })

  it('continues an unfinished load of the same size only', async () => {
    await loadSampleMenuStep(db, admin, { size: 'small' }, ENV)
    await expectApiError(() => loadSampleMenuStep(db, admin, { size: 'large' }, ENV), 409, 'SAMPLE_MENU_OTHER_SIZE')
    const state = await loadSampleMenuStep(db, admin, { size: 'small' }, ENV)
    expect(state.menu.run!.stages[0]).toMatchObject({ key: 'categories', done: 4, total: 8 })
  })

  it('finishes an item a failed step left as a draft, and never duplicates one', async () => {
    // Load everything but the items, then create the last sample item as a crashed step would
    // have: created, never published. (The last: a step's spare budget may already start on items.)
    let state: SampleDataState
    do state = await loadSampleMenuStep(db, admin, { size: 'small' }, ENV)
    while (state.menu.run!.stages.slice(0, 4).some(stage => stage.done < stage.total))
    const croissant = itemsForSize('small').at(-1)!
    const categories = await listCategories(db, TEST_TENANT, { status: 'active' })
    await createItem(db, admin, {
      categoryId: categories.find(c => c.name === 'Bakery')!.id,
      name: croissant.name,
      description: '',
      imageId: null,
      optionSetIds: [],
      variations: [{ valueIds: [], priceMinor: 250, status: 'active' }],
      modifierGroups: [],
      availabilityRuleIds: [],
    })
    await loadAll('small')
    const page = await listItems(db, TEST_TENANT, { page: 1, pageSize: 100, status: 'all' })
    const croissants = page.items.filter(i => i.name === croissant.name)
    expect(croissants).toHaveLength(1)
    expect(croissants[0]!.status).toBe('active')
  })

  it('runs one step at a time: a step while another holds the load is refused', async () => {
    await loadSampleMenuStep(db, admin, { size: 'small' }, ENV)
    const now = new Date()
    expect(await claimRun(db, now, new Date(now.getTime() + 60_000))).toBe(true)
    await expectApiError(() => loadSampleMenuStep(db, admin, { size: 'small' }, ENV, now), 409, 'SAMPLE_DATA_BUSY')
    await expectApiError(() => resetSampleMenu(db, admin, { put: async () => {}, del: async () => {} }, ENV, now), 409, 'SAMPLE_DATA_BUSY')
    // A lock left by a crashed step frees itself.
    const later = new Date(now.getTime() + 61_000)
    await expect(loadSampleMenuStep(db, admin, { size: 'small' }, ENV, later)).resolves.toBeTruthy()
  })
})

describe('reset', () => {
  it('deletes every menu record and upload, forgets the load, and audits it', async () => {
    await loadAll('small')
    for (const n of [1, 2, 3]) {
      await db.insert(mediaAssets).values({ tenantId: TEST_TENANT, objectKey: `menu/photo-${n}.png`, mimeType: 'image/png', byteSize: 10, sha256: 'x', state: 'attached' })
    }
    const deleted: string[] = []
    const state = await resetSampleMenu(db, admin, { put: async () => {}, del: async (key: string) => deleted.push(key) }, ENV)
    expect(state.menu.counts).toEqual({ categories: 0, optionSets: 0, modifierGroups: 0, availabilityRules: 0, items: { draft: 0, active: 0, archived: 0 }, photos: 0 })
    expect(state.menu.run).toBeNull()
    expect(deleted.sort()).toEqual(['menu/photo-1.png', 'menu/photo-2.png', 'menu/photo-3.png'])
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'sample-data.reset'))
    expect(audit).toHaveLength(1)
    // The menu can be loaded again, at another size.
    await expect(loadSampleMenuStep(db, admin, { size: 'large' }, ENV)).resolves.toBeTruthy()
  })
})

describe('sample hours and tables', () => {
  it('sets the hours, then adds the tables a few per call, keeping labels already in use', async () => {
    await createTable(db, admin, branchId, { label: 'T01', area: 'Terrace' }, qr)
    let result = await loadSampleBranch(db, admin, { branchId, tablesOnly: false }, qr, ENV)
    expect((await getBranchSettings(db, TEST_TENANT, branchId)).hours).toHaveLength(7)
    const calls = [result.remainingTables]
    while (result.remainingTables > 0) {
      result = await loadSampleBranch(db, admin, { branchId, tablesOnly: true }, qr, ENV)
      calls.push(result.remainingTables)
    }
    expect(calls).toEqual([7, 3, 0])
    expect(result.state.branches[0]).toMatchObject({ id: branchId, hoursSet: true, tables: SAMPLE_TABLES.length })
  })
})
