import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateProductBody } from '#shared/contracts/menu'
import { mediaAssets, productVariantOptions } from '../../server/db/tables'
import type { Db } from '../../server/db/types'
import type { Actor } from '../../server/features/identity/service'
import { createCategory } from '../../server/features/menu/categories'
import { checkImage, recordUpload, sniffImageType } from '../../server/features/menu/media'
import { createProduct, deleteProduct, getProduct, listMenu, listProducts, updateProduct } from '../../server/features/menu/products'
import { createSchedule } from '../../server/features/menu/schedules'
import { createAdmin, createTestDb } from './support/db'
import { failure } from './support/failure'

let db: Db
let actor: Actor
let categoryId: string
beforeEach(async () => {
  db = await createTestDb()
  actor = await createAdmin(db)
  categoryId = (await createCategory(db, actor, { name: 'Coffee', parentId: null, status: 'ACTIVE' })).id
})

const MILK = {
  name: 'Milk',
  minSelect: 1,
  maxSelect: 1,
  options: [{ name: 'Whole', priceDeltaMinor: 0 }, { name: 'Oat', priceDeltaMinor: 50 }],
}

const input = (overrides: Partial<CreateProductBody> = {}) => ({
  name: 'Latte',
  description: 'Espresso and milk',
  categoryId,
  priceMinor: 420,
  imageAssetId: null,
  status: 'ACTIVE' as const,
  scheduleIds: [] as string[],
  variantGroups: [MILK],
  ...overrides,
}) as Required<CreateProductBody>

describe('create and read', () => {
  it('returns the item with its category, variants in order, and price in cents', async () => {
    const latte = await createProduct(db, actor, input())
    expect(latte).toMatchObject({
      name: 'Latte',
      priceMinor: 420,
      currency: 'USD',
      category: { id: categoryId, name: 'Coffee' },
      image: null,
      sortOrder: 1,
      version: 1,
      variantGroups: [{ name: 'Milk', minSelect: 1, maxSelect: 1, options: [{ name: 'Whole', priceDeltaMinor: 0 }, { name: 'Oat', priceDeltaMinor: 50 }] }],
    })
  })

  it('rejects a category or schedule that does not exist', async () => {
    expect(await failure(createProduct(db, actor, input({ categoryId: crypto.randomUUID() })))).toEqual({ status: 400, code: 'REFERENCE_NOT_FOUND' })
    expect(await failure(createProduct(db, actor, input({ scheduleIds: [crypto.randomUUID()] })))).toEqual({ status: 400, code: 'REFERENCE_NOT_FOUND' })
  })

  it('lists with search, category and status filters, paginated', async () => {
    const tea = await createCategory(db, actor, { name: 'Tea', parentId: null, status: 'ACTIVE' })
    await createProduct(db, actor, input({ name: 'Latte' }))
    await createProduct(db, actor, input({ name: 'Mocha', status: 'INACTIVE' }))
    await createProduct(db, actor, input({ name: 'Sencha', categoryId: tea.id }))
    const names = async (q: Parameters<typeof listProducts>[1]) => (await listProducts(db, q)).items.map(p => p.name)
    expect(await names({ page: 1, pageSize: 20, search: 'CH' })).toEqual(['Mocha', 'Sencha'])
    expect(await names({ page: 1, pageSize: 20, categoryId: tea.id })).toEqual(['Sencha'])
    expect(await names({ page: 1, pageSize: 20, status: 'INACTIVE' })).toEqual(['Mocha'])
    expect(await listProducts(db, { page: 2, pageSize: 2 })).toMatchObject({ total: 3, totalPages: 2 })
    expect((await listMenu(db, {})).map(p => p.name)).toEqual(['Latte', 'Mocha', 'Sencha'])
  })
})

describe('update', () => {
  it('updates, adds and removes variants by id, in the order sent', async () => {
    const latte = await createProduct(db, actor, input())
    const [whole, oat] = latte.variantGroups[0]!.options
    const updated = await updateProduct(db, actor, latte.id, {
      version: 1,
      variantGroups: [
        { name: 'Size', minSelect: 0, maxSelect: null, options: [{ name: 'Large', priceDeltaMinor: 80 }] },
        { id: latte.variantGroups[0]!.id, name: 'Milk choice', minSelect: 1, maxSelect: 1, options: [{ id: oat!.id, name: 'Oat', priceDeltaMinor: 60 }] },
      ],
    })
    expect(updated.version).toBe(2)
    expect(updated.variantGroups.map(g => g.name)).toEqual(['Size', 'Milk choice'])
    expect(updated.variantGroups[1]).toMatchObject({ id: latte.variantGroups[0]!.id, options: [{ id: oat!.id, priceDeltaMinor: 60 }] })
    // The removed option is really gone.
    expect(await db.select().from(productVariantOptions).where(eq(productVariantOptions.id, whole!.id))).toEqual([])
  })

  it('keeps variants and schedules when they are absent, and clears them with []', async () => {
    const schedule = await createSchedule(db, actor, { name: 'All day', description: '', days: ['MONDAY'], startTime: '08:00', endTime: '17:00', status: 'ACTIVE' }, 'Asia/Phnom_Penh')
    const latte = await createProduct(db, actor, input({ scheduleIds: [schedule.id] }))
    const renamed = await updateProduct(db, actor, latte.id, { version: 1, name: 'Café latte' })
    expect(renamed).toMatchObject({ name: 'Café latte', scheduleIds: [schedule.id] })
    expect(renamed.variantGroups).toHaveLength(1)
    const cleared = await updateProduct(db, actor, latte.id, { version: 2, scheduleIds: [], variantGroups: [] })
    expect(cleared).toMatchObject({ scheduleIds: [], variantGroups: [] })
  })

  it('rejects variant ids of another menu item', async () => {
    const latte = await createProduct(db, actor, input())
    const mocha = await createProduct(db, actor, input({ name: 'Mocha' }))
    const foreign = { ...MILK, id: mocha.variantGroups[0]!.id }
    expect(await failure(updateProduct(db, actor, latte.id, { version: 1, variantGroups: [foreign] }))).toEqual({ status: 400, code: 'REFERENCE_NOT_FOUND' })
  })

  it('applies nothing on a stale version, variants included', async () => {
    const latte = await createProduct(db, actor, input())
    await updateProduct(db, actor, latte.id, { version: 1, name: 'Latte 2' })
    const stale = updateProduct(db, actor, latte.id, { version: 1, variantGroups: [] })
    expect(await failure(stale)).toEqual({ status: 409, code: 'VERSION_CONFLICT' })
    expect((await getProduct(db, latte.id)).variantGroups).toHaveLength(1)
  })

  it('of two concurrent saves from one version, exactly one applies', async () => {
    const latte = await createProduct(db, actor, input())
    const results = await Promise.allSettled([
      updateProduct(db, actor, latte.id, { version: 1, variantGroups: [] }),
      updateProduct(db, actor, latte.id, { version: 1, name: 'Other' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const saved = await getProduct(db, latte.id)
    // Either the first save (no variants, old name) or the second (variants kept, new name).
    expect(saved.name === 'Other').toBe(saved.variantGroups.length === 1)
  })
})

describe('images', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

  it('accepts JPEG, PNG and WebP by their bytes, not only their claimed type', () => {
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('image/jpeg')
    expect(checkImage({ type: 'image/png', size: 100, head: PNG }).objectKey).toMatch(/^menu\/[\w-]+\.png$/)
    expect(() => checkImage({ type: 'image/jpeg', size: 100, head: PNG })).toThrow()
    expect(() => checkImage({ type: 'image/png', size: 6 * 1024 * 1024, head: PNG })).toThrow()
  })

  it('attaches an upload to a menu item and releases it when replaced', async () => {
    const first = await recordUpload(db, actor, { objectKey: 'menu/a.png', mimeType: 'image/png', byteSize: 10 })
    const second = await recordUpload(db, actor, { objectKey: 'menu/b.png', mimeType: 'image/png', byteSize: 10 })
    const latte = await createProduct(db, actor, input({ imageAssetId: first.id }))
    expect(latte.image).toEqual({ id: first.id, url: '/media/menu/a.png' })
    // An attached image can't be reused by another item.
    expect(await failure(createProduct(db, actor, input({ name: 'Mocha', imageAssetId: first.id })))).toEqual({ status: 400, code: 'REFERENCE_NOT_FOUND' })

    await updateProduct(db, actor, latte.id, { version: 1, imageAssetId: second.id })
    const states = Object.fromEntries((await db.select().from(mediaAssets)).map(a => [a.objectKey, a.state]))
    expect(states).toEqual({ 'menu/a.png': 'temporary', 'menu/b.png': 'attached' })
  })
})

describe('delete', () => {
  it('deletes with its variants, and refuses a stale version', async () => {
    const latte = await createProduct(db, actor, input())
    expect(await failure(deleteProduct(db, actor, latte.id, 2))).toEqual({ status: 409, code: 'VERSION_CONFLICT' })
    await deleteProduct(db, actor, latte.id, 1)
    expect(await failure(getProduct(db, latte.id))).toEqual({ status: 404, code: 'NOT_FOUND' })
    expect(await db.select().from(productVariantOptions)).toEqual([])
  })
})
