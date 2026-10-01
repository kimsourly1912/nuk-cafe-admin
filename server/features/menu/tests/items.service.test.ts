import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateItemInput } from '#shared/contracts/menu-items'
import type { OptionSet } from '#shared/contracts/menu-options'
import type { Actor } from '#server/features/identity'
import { mediaAssets } from '#server/features/media/media.schema'
import { auditEvents } from '#server/features/platform/platform.schema'
import { archiveCategory, createCategory, updateCategory } from '#server/features/menu/categories.service'
import { archiveItem, createItem, getItem, listItems, publishItem, reorderItems, restoreItem, unpublishItem, updateItem } from '#server/features/menu/items.service'
import { menuCategories, menuItemVariations, menuOptionSets, menuOptionValues } from '#server/features/menu/menu.schema'
import { addOptionValue, archiveOptionSet, archiveOptionValue, createOptionSet, getOptionSet, restoreOptionValue } from '#server/features/menu/options.service'
import { createTestDb } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
const actor: Actor = { userId: 'admin-1', role: 'admin', requestId: 'req-1' }

let drinks: string
let hot: string
let size: OptionSet
let temp: OptionSet

beforeEach(async () => {
  db = await createTestDb()
  const top = await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
  drinks = top.id
  hot = (await createCategory(db, actor, { name: 'Hot drinks', description: '', parentId: drinks, availabilityRuleIds: [] })).id
  size = await createOptionSet(db, actor, { name: 'Size', values: ['Small', 'Large'] })
  temp = await createOptionSet(db, actor, { name: 'Temperature', values: ['Hot', 'Iced'] })
})

const v = (set: OptionSet, name: string) => set.values.find(x => x.name === name)!.id

/** A priced grid for these sets, every cell on at `price` (+50 per row). */
function grid(sets: OptionSet[], price = 300) {
  const rows = sets.reduce<string[][]>((acc, set) => acc.flatMap(row => set.values.filter(x => x.status === 'active').map(x => [...row, x.id])), [[]])
  return rows.map((valueIds, i) => ({ valueIds, priceMinor: price + i * 50, status: 'active' as const }))
}

const latte = (overrides: Partial<CreateItemInput> = {}) => createItem(db, actor, {
  categoryId: hot,
  name: 'Latte',
  description: '',
  imageId: null,
  optionSetIds: [size.id, temp.id],
  variations: grid([size, temp]),
  modifierGroups: [],
  availabilityRuleIds: [],
  ...overrides,
})
const croissant = () => createItem(db, actor, { categoryId: hot, name: 'Croissant', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 250, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })

async function upload() {
  const id = newId()
  await db.insert(mediaAssets).values({ id, objectKey: `menu/${id}.png`, mimeType: 'image/png', byteSize: 10, sha256: 'x' })
  return id
}
const assetState = async (id: string) => (await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)))[0]?.state

describe('creating', () => {
  it('creates a draft with its price grid, one version per combination, in grid order', async () => {
    const item = await latte()
    expect(item).toMatchObject({ name: 'Latte', status: 'draft', categoryId: hot, sortOrder: 1, version: 1 })
    expect(item.optionSets.map(s => s.name)).toEqual(['Size', 'Temperature'])
    expect(item.variations.map(x => [x.label, x.priceMinor, x.sellable])).toEqual([
      ['Small, Hot', 300, true],
      ['Small, Iced', 350, true],
      ['Large, Hot', 400, true],
      ['Large, Iced', 450, true],
    ])
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.targetId, item.id))
    expect(audit).toMatchObject({ action: 'menu.item.create', actorId: 'admin-1' })
  })

  it('creates an item without option sets as a single version', async () => {
    const item = await croissant()
    expect(item.variations).toEqual([expect.objectContaining({ valueIds: [], label: '', priceMinor: 250, sellable: true })])
  })

  it('puts items only in active leaf categories', async () => {
    await expectApiError(() => latte({ categoryId: drinks }), 422, 'CATEGORY_NOT_A_LEAF')
    await archiveCategory(db, actor, hot, { version: 1 })
    await expectApiError(() => latte(), 422, 'CATEGORY_NOT_AVAILABLE')
    await expectApiError(() => latte({ categoryId: newId() }), 422, 'CATEGORY_NOT_AVAILABLE')
  })

  it('refuses an archived option set, and a grid that doesn\'t match its sets', async () => {
    await archiveOptionSet(db, actor, temp.id, { version: temp.version })
    await expectApiError(() => latte(), 422, 'OPTION_SET_NOT_AVAILABLE')
    await expectApiError(() => latte({ optionSetIds: [size.id], variations: grid([size]).slice(1) }), 422, 'PRICE_GRID')
  })

  it('refuses a create when the category gets a sub-category between the check and the write', async () => {
    // Written straight to the table: the API wouldn't nest three levels, but the guard mustn't rely on that.
    const racing = interleaved(db, () => db.insert(menuCategories).values({ name: 'Espresso', parentId: hot }))
    await expectApiError(() => createItem(racing, actor, { categoryId: hot, name: 'Latte', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] }), 422, 'CATEGORY_NOT_A_LEAF')
  })

  it('refuses a create when an option value is archived between the check and the write', async () => {
    const racing = interleaved(db, () => db.update(menuOptionValues).set({ status: 'archived' }).where(eq(menuOptionValues.id, v(size, 'Large'))))
    await expectApiError(() => createItem(racing, actor, { categoryId: hot, name: 'Latte', description: '', imageId: null, optionSetIds: [size.id], variations: grid([size]), modifierGroups: [], availabilityRuleIds: [] }), 422, 'PRICE_GRID')
  })

  it('attaches the image, and refuses one that\'s gone or already used', async () => {
    const image = await upload()
    const item = await latte({ imageId: image })
    expect(item.image).toEqual({ id: image, url: expect.stringMatching(/^\/media\/menu\//) })
    expect(await assetState(image)).toBe('attached')
    await expectApiError(() => croissantWith(image), 422, 'MEDIA_NOT_AVAILABLE')
    await expectApiError(() => croissantWith(newId()), 422, 'MEDIA_NOT_AVAILABLE')
  })

  it('an upload whose item save fails at the write stays unattached: no item points at it, it can be used again, and the hourly purge removes it if not (release check 10.5)', async () => {
    const image = await upload()
    const racing = interleaved(db, () => db.update(menuOptionValues).set({ status: 'archived' }).where(eq(menuOptionValues.id, v(size, 'Large'))))
    await expectApiError(() => createItem(racing, actor, { categoryId: hot, name: 'Latte', description: '', imageId: image, optionSetIds: [size.id], variations: grid([size]), modifierGroups: [], availabilityRuleIds: [] }), 422, 'PRICE_GRID')
    // The batch was all or nothing: the image is still temporary, which the purge deletes after 24 hours (media tests).
    expect(await assetState(image)).toBe('temporary')
    expect((await listItems(db, { categoryId: hot, page: 1, pageSize: 50 })).items.map(item => item.name)).not.toContain('Latte')
    expect((await croissantWith(image)).image?.id).toBe(image)
  })
})

/** A top-level category with an item directly in it (a leaf, since it has no sub-categories). */
async function topLevelWithToast() {
  const id = (await createCategory(db, actor, { name: 'Food', description: '', parentId: null, availabilityRuleIds: [] })).id
  const item = await createItem(db, actor, { categoryId: id, name: 'Toast', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
  return { id, item }
}

const croissantWith = (imageId: string) => createItem(db, actor, { categoryId: hot, name: 'Croissant', description: '', imageId, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 250, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })

describe('updating', () => {
  it('changes prices and switches, keeping every version\'s id', async () => {
    const item = await latte()
    const cells = grid([size, temp], 500)
    cells[3]!.status = 'disabled' as never
    const updated = await updateItem(db, actor, item.id, { version: 1, variations: cells })
    expect(updated.variations.map(x => x.id)).toEqual(item.variations.map(x => x.id))
    expect(updated.variations.map(x => [x.priceMinor, x.status])).toEqual([[500, 'active'], [550, 'active'], [600, 'active'], [650, 'disabled']])
    expect(updated.version).toBe(2)
  })

  it('retires the old versions when the option sets change, and brings them back when they return', async () => {
    const item = await latte()
    const single = await updateItem(db, actor, item.id, { version: 1, optionSetIds: [size.id], variations: grid([size]) })
    expect(single.variations.map(x => x.label)).toEqual(['Small', 'Large'])
    const retired = await db.select().from(menuItemVariations).where(eq(menuItemVariations.status, 'retired'))
    expect(retired).toHaveLength(4)
    const back = await updateItem(db, actor, item.id, { version: single.version, optionSetIds: [size.id, temp.id], variations: grid([size, temp]) })
    expect(back.variations.map(x => x.id)).toEqual(item.variations.map(x => x.id))
  })

  it('refuses new option sets without the new grid (in the contract) or with a wrong one', async () => {
    const item = await latte()
    await expectApiError(() => updateItem(db, actor, item.id, { version: 1, optionSetIds: [size.id], variations: grid([size, temp]) }), 422, 'PRICE_GRID')
  })

  it('keeps an option set on an item after it\'s archived in the library, but won\'t add an archived one', async () => {
    const item = await latte()
    await archiveOptionSet(db, actor, temp.id, { version: temp.version })
    await expect(updateItem(db, actor, item.id, { version: 1, variations: grid([size, temp], 600) })).resolves.toMatchObject({ version: 2 })
    const plain = await croissant()
    await expectApiError(() => updateItem(db, actor, plain.id, { version: 1, optionSetIds: [temp.id], variations: grid([temp]) }), 422, 'OPTION_SET_NOT_AVAILABLE')
  })

  it('hides versions that use an archived value, and shows them again when it\'s restored', async () => {
    const item = await latte()
    const archived = await archiveOptionValue(db, actor, size.id, v(size, 'Large'), { version: size.version })
    const hidden = await getItem(db, item.id)
    expect(hidden.variations.map(x => [x.label, x.sellable])).toEqual([['Small, Hot', true], ['Small, Iced', true], ['Large, Hot', false], ['Large, Iced', false]])
    // Saving the grid without the archived value keeps those versions for later.
    const saved = await updateItem(db, actor, item.id, { version: 1, variations: grid([{ ...size, values: size.values.filter(x => x.name !== 'Large') }, temp], 700) })
    expect(saved.variations).toHaveLength(4)
    await restoreOptionValue(db, actor, size.id, v(size, 'Large'), { version: archived.version })
    expect((await getItem(db, item.id)).variations.every(x => x.sellable)).toBe(true)
  })

  it('shows a value added to a set as missing from the grid until it\'s priced or switched off', async () => {
    const item = await latte()
    const bigger = await addOptionValue(db, actor, size.id, { version: size.version, name: 'Extra large' })
    await expectApiError(() => updateItem(db, actor, item.id, { version: 1, variations: grid([size, temp]) }), 422, 'PRICE_GRID')
    await expect(updateItem(db, actor, item.id, { version: 1, variations: grid([bigger, temp]) })).resolves.toMatchObject({ version: 2 })
  })

  it('moves the item to the end of another leaf category', async () => {
    const iced = (await createCategory(db, actor, { name: 'Iced drinks', description: '', parentId: drinks, availabilityRuleIds: [] })).id
    await createItem(db, actor, { categoryId: iced, name: 'Iced tea', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 200, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
    const item = await latte()
    const moved = await updateItem(db, actor, item.id, { version: 1, categoryId: iced })
    expect(moved).toMatchObject({ categoryId: iced, sortOrder: 2 })
    await expectApiError(() => updateItem(db, actor, item.id, { version: 2, categoryId: drinks }), 422, 'CATEGORY_NOT_A_LEAF')
  })

  it('replaces the image (releasing the old one) and removes it', async () => {
    const first = await upload()
    const second = await upload()
    const item = await latte({ imageId: first })
    const replaced = await updateItem(db, actor, item.id, { version: 1, imageId: second })
    expect(replaced.image?.id).toBe(second)
    expect([await assetState(first), await assetState(second)]).toEqual(['temporary', 'attached'])
    const removed = await updateItem(db, actor, item.id, { version: 2, imageId: null })
    expect(removed.image).toBeNull()
    expect(await assetState(second)).toBe('temporary')
  })

  it('refuses a stale version, also one that arrives between the check and the write, and an archived item', async () => {
    const item = await latte()
    await updateItem(db, actor, item.id, { version: 1, name: 'Caffè latte' })
    await expectApiError(() => updateItem(db, actor, item.id, { version: 1, name: 'Latte' }), 409, 'VERSION_CONFLICT')
    const racing = interleaved(db, () => updateItem(db, actor, item.id, { version: 2, description: 'Milky' }))
    await expectApiError(() => updateItem(racing, actor, item.id, { version: 2, name: 'Latte' }), 409, 'VERSION_CONFLICT')
    const archived = await archiveItem(db, actor, item.id, { version: 3 })
    await expectApiError(() => updateItem(db, actor, item.id, { version: archived.version, name: 'X' }), 409, 'INVALID_STATE')
  })

  it('refuses adding an option set archived between the check and the write', async () => {
    const plain = await croissant()
    const racing = interleaved(db, () => db.update(menuOptionSets).set({ status: 'archived' }).where(eq(menuOptionSets.id, size.id)))
    await expectApiError(() => updateItem(racing, actor, plain.id, { version: 1, optionSetIds: [size.id], variations: grid([size]), modifierGroups: [] }), 422, 'OPTION_SET_NOT_AVAILABLE')
  })
})

describe('publishing and archiving', () => {
  it('publishes a draft with something to sell; unpublishes it again', async () => {
    const item = await latte()
    const live = await publishItem(db, actor, item.id, { version: 1 })
    expect(live.status).toBe('active')
    await expectApiError(() => publishItem(db, actor, item.id, { version: live.version }), 409, 'INVALID_STATE')
    await expect(unpublishItem(db, actor, item.id, { version: live.version })).resolves.toMatchObject({ status: 'draft' })
  })

  it('won\'t publish an item with nothing sellable', async () => {
    const item = await createItem(db, actor, { categoryId: hot, name: 'Tea', description: '', imageId: null, optionSetIds: [size.id], variations: [{ valueIds: [v(size, 'Small')], priceMinor: 200, status: 'active' }, { valueIds: [v(size, 'Large')], priceMinor: null, status: 'disabled' }], modifierGroups: [], availabilityRuleIds: [] })
    await archiveOptionValue(db, actor, size.id, v(size, 'Small'), { version: size.version })
    await expectApiError(() => publishItem(db, actor, item.id, { version: 1 }), 422, 'NOTHING_TO_SELL')
  })

  it('archives from draft or active, and restores to a draft at the end of its category', async () => {
    const item = await latte()
    await croissant()
    const archived = await archiveItem(db, actor, item.id, { version: 1 })
    expect(archived.status).toBe('archived')
    await expectApiError(() => archiveItem(db, actor, item.id, { version: archived.version }), 409, 'INVALID_STATE')
    const restored = await restoreItem(db, actor, item.id, { version: archived.version })
    expect(restored).toMatchObject({ status: 'draft', sortOrder: 3 })
  })

  it('won\'t restore into a category that has since got sub-categories', async () => {
    // A top-level category holding items directly is a leaf too.
    const food = await topLevelWithToast()
    const archived = await archiveItem(db, actor, food.item.id, { version: 1 })
    await createCategory(db, actor, { name: 'Sandwiches', description: '', parentId: food.id, availabilityRuleIds: [] })
    await expectApiError(() => restoreItem(db, actor, food.item.id, { version: archived.version }), 422, 'CATEGORY_NOT_A_LEAF')
  })
})

describe('listing and ordering', () => {
  it('lists drafts and active items with their price range; archived ones on request', async () => {
    const item = await latte()
    const plain = await croissant()
    await archiveItem(db, actor, plain.id, { version: 1 })
    const page = await listItems(db, { page: 1, pageSize: 20 })
    expect(page.items).toEqual([expect.objectContaining({ id: item.id, categoryName: 'Hot drinks', priceMinMinor: 300, priceMaxMinor: 450, status: 'draft' })])
    expect((await listItems(db, { page: 1, pageSize: 20, status: 'archived' })).items.map(i => i.name)).toEqual(['Croissant'])
    expect((await listItems(db, { page: 1, pageSize: 20, status: 'all', search: 'LAT' })).items.map(i => i.name)).toEqual(['Latte'])
  })

  it('reorders a category\'s items; the list must be exactly them', async () => {
    const a = await latte()
    const b = await croissant()
    await reorderItems(db, actor, { categoryId: hot, items: [b, a].map(x => ({ id: x.id, version: x.version })) })
    expect((await listItems(db, { page: 1, pageSize: 20, categoryId: hot })).items.map(i => i.name)).toEqual(['Croissant', 'Latte'])
    await expectApiError(() => reorderItems(db, actor, { categoryId: hot, items: [{ id: a.id, version: a.version }] }), 409, 'VERSION_CONFLICT')
  })

  it('counts the items that use an option set', async () => {
    await latte()
    expect((await getOptionSet(db, size.id)).itemCount).toBe(1)
  })
})

describe('the category side of "items only in leaves"', () => {
  it('won\'t add a sub-category to a category with items, also when an item arrives meanwhile', async () => {
    const food = await topLevelWithToast()
    await expectApiError(() => createCategory(db, actor, { name: 'Sandwiches', description: '', parentId: food.id, availabilityRuleIds: [] }), 422, 'CATEGORY_HAS_ITEMS')
    const iced = await createCategory(db, actor, { name: 'Iced', description: '', parentId: null, availabilityRuleIds: [] })
    const racing = interleaved(db, () => createItem(db, actor, { categoryId: iced.id, name: 'Frappe', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 400, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] }))
    await expectApiError(() => createCategory(racing, actor, { name: 'Frozen', description: '', parentId: iced.id, availabilityRuleIds: [] }), 422, 'CATEGORY_HAS_ITEMS')
  })

  it('won\'t move a category under one that gets an item meanwhile', async () => {
    const iced = await createCategory(db, actor, { name: 'Iced', description: '', parentId: null, availabilityRuleIds: [] })
    const frozen = await createCategory(db, actor, { name: 'Frozen', description: '', parentId: null, availabilityRuleIds: [] })
    const racing = interleaved(db, () => createItem(db, actor, { categoryId: iced.id, name: 'Frappe', description: '', imageId: null, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 400, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] }))
    await expectApiError(() => updateCategory(racing, actor, frozen.id, { version: frozen.version, parentId: iced.id }), 422, 'CATEGORY_HAS_ITEMS')
  })

  it('archived items don\'t hold a category', async () => {
    const food = await topLevelWithToast()
    await archiveItem(db, actor, food.item.id, { version: 1 })
    await expect(createCategory(db, actor, { name: 'Sandwiches', description: '', parentId: food.id, availabilityRuleIds: [] })).resolves.toMatchObject({ parentId: food.id })
  })
})
