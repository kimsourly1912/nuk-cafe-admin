import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Actor } from '#server/features/identity'
import type { Db } from '#server/utils/batch'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { interleaved } from '#server/tests/support/interleave'
import { createAvailabilityRule, createCategory, createItem, createModifierGroup, createOptionSet, getItem } from '#server/features/menu'
import type { ImportObjectStore } from '#server/features/assistant'
import { createImportDraft, discardImportSource, getImportReview, updateImportReviewRow, uploadImportSource } from '#server/features/assistant'
import { assistantImports, assistantUsage } from '#server/features/assistant/assistant.schema'
import { IMPORT_DRAFT_MAX_STATEMENTS } from '#server/features/assistant/assistant-drafts.service'
import { toReviewRows } from '#server/features/assistant/assistant-extraction'
import { ASSISTANT_IMPORT_REVIEW_MAX_BYTES } from '#shared/contracts/assistant-import'
import { auditEvents, idempotencyKeys } from '#server/features/platform/platform.schema'
import { menuCategories, menuItems, menuOptionSets } from '#server/features/menu/menu.schema'
import * as menuRepo from '#server/features/menu/items.repository'
import * as sourceRepo from '#server/features/assistant/assistant-import.repository'
import type { AssistantImportDraft, CreateAssistantImportDraftInput } from '#shared/contracts/assistant-import'

const PNG = new Uint8Array(readFileSync(new URL('../eval/fixtures/columns-and-sizes.png', import.meta.url)))
let db: Db
let actor: Actor
let categoryId: string
let store: ImportObjectStore
beforeEach(async () => {
  db = await createTestDb()
  actor = { ...await createAdmin(db), tenantId: TEST_TENANT, role: 'owner' }
  categoryId = (await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })).id
  const objects = new Map<string, Blob>()
  store = {
    driver: { name: 'fs' }, put: async (key, bytes, options) => { objects.set(key, new Blob([bytes], { type: options.contentType })) },
    get: async key => objects.get(key) ?? null, del: async (key) => { objects.delete(key) },
  }
})
afterEach(() => vi.restoreAllMocks())

async function review(count = 1) {
  const source = await uploadImportSource(db, store, actor, { type: 'image/png', data: PNG, fileName: 'private-menu.png' })
  const rows = toReviewRows({ items: Array.from({ length: count }, (_, i) => ({ name: `Coffee ${i + 1}`, description: 'Source description', category: 'Drinks', prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] })), truncated: false })
  rows.forEach(r => r.draft.categoryId = categoryId)
  await db.update(assistantImports).set({ reviewState: 'ready', reviewRows: rows, version: 3 }).where(eq(assistantImports.id, source.id))
  return { source, rows }
}
const command = (version = 3, confirmDuplicate = false): CreateAssistantImportDraftInput => ({ version, confirmDuplicate })
const items = () => db.select().from(menuItems)
const keys = () => db.select().from(idempotencyKeys)
const menuInput = (draft: AssistantImportDraft) => ({ ...draft, categoryId: draft.categoryId!, imageId: null })

it('creates an unpublished menu draft from the saved correction and persists only an id receipt', async () => {
  const { source, rows } = await review()
  const row = rows[0]!
  await updateImportReviewRow(db, actor, source.id, row.id, { version: 3, draft: { ...row.draft, name: 'Corrected coffee', description: 'Owner description' } })
  const result = await createImportDraft(db, actor, source.id, row.id, command(4), crypto.randomUUID())
  expect(result).toMatchObject({ sourceId: source.id, rowId: row.id, version: 5, replayed: false, alreadyCreated: false })
  expect(await getItem(db, actor.tenantId, result.itemId)).toMatchObject({ name: 'Corrected coffee', description: 'Owner description', status: 'draft', image: null, categoryId })
  const resumed = await getImportReview(db, actor, source.id)
  expect(resumed).toMatchObject({ source: { version: 5, expiresAt: source.expiresAt }, rows: [{ source: row.source, createdItemId: result.itemId }] })
  expect(JSON.stringify(await keys())).not.toContain('coffee')
  expect(JSON.stringify(await keys())).not.toContain('$2.50')
  const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, 'assistant.import.draft.created'))
  expect(audit).toMatchObject([{ metadata: { rowId: row.id, itemId: result.itemId } }])
  expect(JSON.stringify(audit)).not.toContain('Owner description')
  expect(await db.select().from(assistantUsage)).toEqual([])
})

it('replays the same key and survives a different key or an expired idempotency record without creating twice', async () => {
  const { source, rows } = await review()
  const rowId = rows[0]!.id
  const key = crypto.randomUUID()
  const first = await createImportDraft(db, actor, source.id, rowId, command(), key)
  expect(await createImportDraft(db, actor, source.id, rowId, command(), key)).toEqual({ ...first, replayed: true })
  await db.delete(idempotencyKeys)
  expect(await createImportDraft(db, actor, source.id, rowId, command(4, true), crypto.randomUUID())).toMatchObject({ itemId: first.itemId, alreadyCreated: true, version: 4 })
  expect(await items()).toHaveLength(1)
  expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.item.create'))).toHaveLength(1)
})

it('rejects a reused key with different source/row/version/duplicate confirmation', async () => {
  const { source, rows } = await review(2)
  const key = crypto.randomUUID()
  await createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)
  for (const [rowId, input] of [[rows[1]!.id, command()], [rows[0]!.id, command(4)], [rows[0]!.id, command(3, true)]] as const) {
    await expect(createImportDraft(db, actor, source.id, rowId, input, key)).rejects.toMatchObject({ statusCode: 422, data: { code: 'IDEMPOTENCY_MISMATCH' } })
  }
  expect(await items()).toHaveLength(1)
})

it('does not expose or replay another cafe/creator or a discarded/expired source', async () => {
  const { source, rows } = await review()
  const key = crypto.randomUUID()
  await createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)
  await ensureTenant(db, 'other-cafe')
  const other = await createAdmin(db)
  for (const outsider of [{ ...actor, tenantId: 'other-cafe' }, { ...actor, userId: other.userId }]) {
    await expect(createImportDraft(db, outsider, source.id, rows[0]!.id, command(), key)).rejects.toMatchObject({ statusCode: 404 })
  }
  await db.update(assistantImports).set({ expiresAt: new Date(0) }).where(eq(assistantImports.id, source.id))
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)).rejects.toMatchObject({ statusCode: 404 })
  expect(await items()).toHaveLength(1)
})

it('locks created review rows and keeps explicit drafts after source discard', async () => {
  const { source, rows } = await review()
  const result = await createImportDraft(db, actor, source.id, rows[0]!.id, command(), crypto.randomUUID())
  await expect(updateImportReviewRow(db, actor, source.id, rows[0]!.id, { version: 4, selected: false })).rejects.toMatchObject({ statusCode: 409, data: { code: 'AI_IMPORT_ROW_CREATED' } })
  await discardImportSource(db, store, actor, source.id, 4)
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(), crypto.randomUUID())).rejects.toMatchObject({ statusCode: 404 })
  expect(await getItem(db, actor.tenantId, result.itemId)).toMatchObject({ status: 'draft' })
})

it('leaves invalid/unselected rows and saved corrections available for partial-success retry', async () => {
  const { source, rows } = await review(3)
  const incomplete = { ...rows[1]!.draft, categoryId: null }
  await updateImportReviewRow(db, actor, source.id, rows[1]!.id, { version: 3, draft: incomplete })
  await updateImportReviewRow(db, actor, source.id, rows[2]!.id, { version: 4, selected: false })
  await createImportDraft(db, actor, source.id, rows[0]!.id, command(5), crypto.randomUUID())
  const retryKey = crypto.randomUUID()
  await expect(createImportDraft(db, actor, source.id, rows[1]!.id, command(6), retryKey)).rejects.toMatchObject({ statusCode: 400, data: { fieldErrors: { categoryId: expect.any(Array) } } })
  await expect(createImportDraft(db, actor, source.id, rows[2]!.id, command(6), crypto.randomUUID())).rejects.toMatchObject({ data: { code: 'AI_IMPORT_ROW_EXCLUDED' } })
  const unchanged = await getImportReview(db, actor, source.id)
  expect(unchanged.source.version).toBe(6)
  expect(unchanged.rows[1]!.draft).toEqual(incomplete)
  await updateImportReviewRow(db, actor, source.id, rows[1]!.id, { version: 6, draft: rows[1]!.draft })
  await createImportDraft(db, actor, source.id, rows[1]!.id, command(7), retryKey)
  expect(await items()).toHaveLength(2)
})

it.each([
  ['missing-name', 400, 'VALIDATION_FAILED'], ['unpriced', 422, 'PRICE_GRID'], ['missing-grid', 400, 'VALIDATION_FAILED'],
  ['category-parent', 422, 'CATEGORY_NOT_A_LEAF'], ['category-archived', 422, 'CATEGORY_NOT_AVAILABLE'], ['foreign-category', 422, 'CATEGORY_NOT_AVAILABLE'],
  ['foreign-options', 422, 'OPTION_SET_NOT_AVAILABLE'], ['foreign-add-ons', 422, 'MODIFIER_GROUP_NOT_AVAILABLE'], ['foreign-rule', 422, 'AVAILABILITY_RULE_NOT_AVAILABLE'],
])('uses the existing menu rules for %s without a receipt/key or menu write', async (problem, statusCode, code) => {
  const { source, rows } = await review()
  const draft = structuredClone(rows[0]!.draft)
  if (problem === 'missing-name') draft.name = '   '
  if (problem === 'unpriced') draft.variations[0]!.priceMinor = null
  if (problem === 'missing-grid') draft.variations = []
  if (problem === 'category-parent') await createCategory(db, actor, { name: 'Child', description: '', parentId: categoryId, availabilityRuleIds: [] })
  if (problem === 'category-archived') await db.update(menuCategories).set({ status: 'archived' }).where(eq(menuCategories.id, categoryId))
  const foreign = { ...actor, tenantId: 'foreign-cafe' }
  await ensureTenant(db, foreign.tenantId)
  if (problem === 'foreign-category') draft.categoryId = (await createCategory(db, foreign, { name: 'Foreign', description: '', parentId: null, availabilityRuleIds: [] })).id
  if (problem === 'foreign-options') draft.optionSetIds = [(await createOptionSet(db, foreign, { name: 'Foreign size', values: ['S'] })).id]
  if (problem === 'foreign-add-ons') draft.modifierGroups = [{ groupId: (await createModifierGroup(db, foreign, { name: 'Foreign extras', minSelect: 0, maxSelect: null, modifiers: [{ name: 'Shot', priceDeltaMinor: 100, isDefault: false }] })).id, rules: null, prices: [] }]
  if (problem === 'foreign-rule') draft.availabilityRuleIds = [(await createAvailabilityRule(db, foreign, { name: 'Foreign time', windows: [{ weekday: 1, startMinute: 0, endMinute: 60 }] })).id]
  await updateImportReviewRow(db, actor, source.id, rows[0]!.id, { version: 3, draft })
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(4), crypto.randomUUID())).rejects.toMatchObject({ statusCode, data: { code } })
  expect(await items()).toEqual([])
  expect(await keys()).toEqual([])
  expect((await getImportReview(db, actor, source.id)).rows[0]).not.toHaveProperty('createdItemId')
})

it('requires explicit duplicate confirmation for matching names in this cafe, including archived items', async () => {
  const { source, rows } = await review()
  const existing = await createItem(db, actor, menuInput({ ...rows[0]!.draft, name: 'COFFEE 1' }))
  await db.update(menuItems).set({ status: 'archived' }).where(eq(menuItems.id, existing.id))
  const key = crypto.randomUUID()
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)).rejects.toMatchObject({ statusCode: 409, data: { code: 'ITEM_NAME_EXISTS' } })
  expect(await keys()).toEqual([])
  await createImportDraft(db, actor, source.id, rows[0]!.id, command(3, true), key)
  expect(await items()).toHaveLength(2)
})

it('another cafe’s matching name does not block creation', async () => {
  const { source, rows } = await review()
  await ensureTenant(db, 'foreign-cafe')
  const foreign = { ...actor, tenantId: 'foreign-cafe' }
  const category = await createCategory(db, foreign, { name: 'Foreign', description: '', parentId: null, availabilityRuleIds: [] })
  await createItem(db, foreign, { ...menuInput(rows[0]!.draft), categoryId: category.id })
  await createImportDraft(db, actor, source.id, rows[0]!.id, command(), crypto.randomUUID())
  expect(await items()).toHaveLength(2)
})

it('rolls back receipt/key/menu/audit when an item with the same name is created after planning', async () => {
  const { source, rows } = await review()
  const raced = interleaved(db, () => createItem(db, actor, menuInput(rows[0]!.draft)))
  await expect(createImportDraft(raced, actor, source.id, rows[0]!.id, command(), crypto.randomUUID())).rejects.toMatchObject({ data: { code: 'ITEM_NAME_EXISTS' } })
  expect(await items()).toHaveLength(1)
  expect(await keys()).toEqual([])
  expect((await getImportReview(db, actor, source.id)).source.version).toBe(3)
})

it.each([['edit', 409, 'VERSION_CONFLICT'], ['discard', 404, 'NOT_FOUND'], ['expiry', 404, 'NOT_FOUND'], ['category', 422, 'CATEGORY_NOT_AVAILABLE'], ['options', 422, 'OPTION_SET_NOT_AVAILABLE']])('rolls the whole batch back when %s races with creation', async (change, statusCode, code) => {
  const { source, rows } = await review()
  if (change === 'options') {
    const size = await createOptionSet(db, actor, { name: 'Size', values: ['Small'] })
    rows[0]!.draft.optionSetIds = [size.id]
    rows[0]!.draft.variations[0]!.valueIds = [size.values[0]!.id]
    await db.update(assistantImports).set({ reviewRows: rows }).where(eq(assistantImports.id, source.id))
  }
  const raced = interleaved(db, async () => {
    if (change === 'edit') await updateImportReviewRow(db, actor, source.id, rows[0]!.id, { version: 3, selected: false })
    if (change === 'discard') await discardImportSource(db, store, actor, source.id, 3)
    if (change === 'expiry') await db.update(assistantImports).set({ expiresAt: new Date(0) }).where(eq(assistantImports.id, source.id))
    if (change === 'category') await db.update(menuCategories).set({ status: 'archived' }).where(eq(menuCategories.id, categoryId))
    if (change === 'options') await db.update(menuOptionSets).set({ status: 'archived' }).where(eq(menuOptionSets.id, rows[0]!.draft.optionSetIds[0]!))
  })
  await expect(createImportDraft(raced, actor, source.id, rows[0]!.id, command(), crypto.randomUUID())).rejects.toMatchObject({ statusCode, data: { code } })
  expect(await items()).toEqual([])
  expect(await keys()).toEqual([])
  expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'assistant.import.draft.created'))).toEqual([])
})

it('replays racing identical keys and rejects competing different keys without duplicate menu writes', async () => {
  const { source, rows } = await review()
  const key = crypto.randomUUID()
  const first = await Promise.all([createImportDraft(db, actor, source.id, rows[0]!.id, command(), key), createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)])
  expect(first[0].itemId).toBe(first[1].itemId)
  expect(first.map(r => r.replayed).sort()).toEqual([false, true])
  expect(await items()).toHaveLength(1)
  const next = await review()
  const race = await Promise.allSettled([createImportDraft(db, actor, next.source.id, next.rows[0]!.id, command(3, true), crypto.randomUUID()), createImportDraft(db, actor, next.source.id, next.rows[0]!.id, command(3, true), crypto.randomUUID())])
  expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(await items()).toHaveLength(2)
})

it('bounds complex grid writes before committing and never leaks driver document parameters', async () => {
  const { source, rows } = await review()
  const size = await createOptionSet(db, actor, { name: 'Size', values: Array.from({ length: 20 }, (_, i) => `Size ${i}`) })
  const draft = { ...rows[0]!.draft, optionSetIds: [size.id], variations: size.values.map(v => ({ valueIds: [v.id], priceMinor: 250, status: 'active' as const })) }
  await updateImportReviewRow(db, actor, source.id, rows[0]!.id, { version: 3, draft })
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(4), crypto.randomUUID())).rejects.toMatchObject({ data: { code: 'AI_IMPORT_DRAFT_TOO_COMPLEX' } })
  expect(await items()).toEqual([])
  expect(await keys()).toEqual([])
  const simple = await review()
  const broken = interleaved(db, async () => {
    throw new Error('SQL insert with private-menu.png Coffee $2.50')
  })
  const error = await createImportDraft(broken, actor, simple.source.id, simple.rows[0]!.id, command(), crypto.randomUUID()).catch(e => e)
  expect(error).toMatchObject({ statusCode: 503, data: { code: 'AI_IMPORT_DRAFT_UNAVAILABLE' } })
  expect(JSON.stringify(error)).not.toContain('$2.50')
  expect(await items()).toEqual([])
})

it('accepts a two-by-two option grid within its write budget', async () => {
  const { source, rows } = await review()
  const size = await createOptionSet(db, actor, { name: 'Size', values: ['S', 'L'] })
  const temp = await createOptionSet(db, actor, { name: 'Temperature', values: ['Hot', 'Iced'] })
  const draft = { ...rows[0]!.draft, optionSetIds: [size.id, temp.id], variations: size.values.flatMap(s => temp.values.map(t => ({ valueIds: [s.id, t.id], priceMinor: 250, status: 'active' as const }))) }
  await updateImportReviewRow(db, actor, source.id, rows[0]!.id, { version: 3, draft })
  const batch = vi.spyOn(db, 'batch')
  const result = await createImportDraft(db, actor, source.id, rows[0]!.id, command(4), crypto.randomUUID())
  expect(batch.mock.calls[0]![0].length).toBeLessThanOrEqual(IMPORT_DRAFT_MAX_STATEMENTS + 4)
  expect((await getItem(db, actor.tenantId, result.itemId)).variations).toHaveLength(4)
})

it('replays an identical call that committed while the losing call was still planning', async () => {
  const { source, rows } = await review()
  const key = crypto.randomUUID()
  vi.spyOn(menuRepo, 'itemNameExists').mockImplementationOnce(async () => {
    await createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)
    return true
  })
  const result = await createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)
  expect(result.replayed).toBe(true)
  expect(await items()).toHaveLength(1)
})

it('rechecks source access after a replay lookup and never revives a concurrently discarded source', async () => {
  const { source, rows } = await review()
  const key = crypto.randomUUID()
  await createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)
  const original = sourceRepo.findSource
  let reads = 0
  vi.spyOn(sourceRepo, 'findSource').mockImplementation(async (...args) => {
    if (++reads === 2) await discardImportSource(db, store, actor, source.id, 4)
    return original(...args)
  })
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)).rejects.toMatchObject({ statusCode: 404 })
  expect(await items()).toHaveLength(1)
})

it('refuses a receipt that would exceed the private-review byte cap without losing corrections', async () => {
  const { source, rows } = await review(50)
  let remaining = ASSISTANT_IMPORT_REVIEW_MAX_BYTES - 10 - new TextEncoder().encode(JSON.stringify(rows)).byteLength
  for (const row of rows) {
    for (const part of [row.draft, row.source]) {
      const added = Math.min(remaining, 500 - part.description!.length)
      part.description += 'x'.repeat(added)
      remaining -= added
    }
  }
  expect(remaining).toBe(0)
  await db.update(assistantImports).set({ reviewRows: rows }).where(eq(assistantImports.id, source.id))
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(), crypto.randomUUID())).rejects.toMatchObject({ statusCode: 413 })
  expect(await items()).toEqual([])
  expect(await keys()).toEqual([])
  expect((await getImportReview(db, actor, source.id)).rows).toEqual(rows)
})

it('rechecks source access after the late-planning replay lookup', async () => {
  const { source, rows } = await review()
  const key = crypto.randomUUID()
  let discardOnRead = false
  const original = sourceRepo.findSource
  vi.spyOn(sourceRepo, 'findSource').mockImplementation(async (...args) => {
    const snapshot = await original(...args)
    if (discardOnRead) {
      discardOnRead = false
      await discardImportSource(db, store, actor, source.id, 4)
    }
    return snapshot
  })
  vi.spyOn(menuRepo, 'itemNameExists').mockImplementationOnce(async () => {
    await createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)
    discardOnRead = true
    return true
  })
  await expect(createImportDraft(db, actor, source.id, rows[0]!.id, command(), key)).rejects.toMatchObject({ statusCode: 404 })
  expect(await items()).toHaveLength(1)
})
