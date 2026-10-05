import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Actor } from '#server/features/identity'
import type { Db } from '#server/utils/batch'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { cancelImportExtraction, createImportDraft, discardImportSource, extractImportPdfPage, finishImportPdf, getImportReview, importSettingsFrom, languageModel, prepareImportPdf, purgeImportSources, updateImportReviewRow, uploadImportSource } from '#server/features/assistant'
import type { CloudflareAiBinding, ImportObjectStore } from '#server/features/assistant'
import { assistantImportLeases, assistantImportObjects, assistantImports, assistantUsage } from '#server/features/assistant/assistant.schema'
import { auditEvents } from '#server/features/platform/platform.schema'
import { menuItems } from '#server/features/menu/menu.schema'
import { createCategory } from '#server/features/menu'
import { checkPdfPageImage } from '#server/features/assistant/assistant-pdf'
import * as pdfRepo from '#server/features/assistant/assistant-pdf.repository'

const PNG = new Uint8Array(readFileSync(new URL('../eval/fixtures/columns-and-sizes.png', import.meta.url)))
const PDF = new Uint8Array(readFileSync(new URL('../eval/fixtures/mixed.pdf', import.meta.url)))
const evidence = { name: 'Coffee', description: null, category: 'Drinks', prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] }
const output = (count = 1) => ({ items: Array.from({ length: count }, () => structuredClone(evidence)), truncated: false })
const usage = { inputTokens: { total: 12, noCache: 4, cacheRead: 8, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } }
const completion = (value: unknown = output()) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [] })
type Generate = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>['doGenerate']
type GenerateFunction = Extract<Generate, (...args: never[]) => unknown>
let db: Db
let actor: Actor
let generate: ReturnType<typeof vi.fn<GenerateFunction>>
let objects: Map<string, Blob>
let store: ImportObjectStore
const settings = importSettingsFrom({ importModel: '@cf/google/gemma-4-26b-a4b-it', dailyLimit: 20 })
const context = () => ({ settings, model: new MockLanguageModelV4({ doGenerate: generate }) })
const upload = () => uploadImportSource(db, store, actor, { type: 'application/pdf', data: PDF, fileName: 'private-menu.pdf' })
const prepared = async (pageNumbers = [1, 2]) => {
  const source = await upload()
  return prepareImportPdf(db, actor, source.id, { version: source.version, pageNumbers })
}
const extract = (id: string, pageNumber: number, version: number, signal?: AbortSignal) => extractImportPdfPage(db, store, actor, id, pageNumber, version, PNG, context, signal)
const usageRows = () => db.select().from(assistantUsage)
const sourceRow = async (id: string) => (await db.select().from(assistantImports).where(eq(assistantImports.id, id)))[0]!

beforeEach(async () => {
  db = await createTestDb()
  actor = { ...(await createAdmin(db)), tenantId: TEST_TENANT, role: 'owner' }
  objects = new Map()
  store = { driver: { name: 'fs' }, put: async (key, bytes, options) => {
    objects.set(key, new Blob([bytes], { type: options.contentType }))
  }, get: async key => objects.get(key) ?? null, del: async (key) => { objects.delete(key) } }
  generate = vi.fn<GenerateFunction>(async () => completion())
})

it('fixes a sorted manifest with no model call, unchanged TTL and strict page labels', async () => {
  const source = await upload()
  for (const pageNumbers of [[], [1, 1], [0], [6], [1.5], [1, 2, 3, 4, 5, 5]]) {
    await expect(prepareImportPdf(db, actor, source.id, { version: 1, pageNumbers })).rejects.toMatchObject({ statusCode: 400 })
  }
  const ready = await prepareImportPdf(db, actor, source.id, { version: 1, pageNumbers: [2, 1] })
  expect(ready).toMatchObject({ state: 'none', rows: [], source: { version: 2, expiresAt: source.expiresAt }, pdf: { pages: [{ pageNumber: 1, state: 'pending', attempts: 0 }, { pageNumber: 2, state: 'pending' }] } })
  expect(await prepareImportPdf(db, actor, source.id, { version: 2, pageNumbers: [2, 1] })).toEqual(ready)
  await expect(prepareImportPdf(db, actor, source.id, { version: 1, pageNumbers: [1, 2] })).rejects.toMatchObject({ statusCode: 409 })
  await expect(prepareImportPdf(db, actor, source.id, { version: 2, pageNumbers: [1] })).rejects.toMatchObject({ data: { code: 'AI_IMPORT_PDF_SELECTION_FIXED' } })
  expect(await usageRows()).toEqual([])
  expect(generate).not.toHaveBeenCalled()
})

it('processes through the installed binding adapter, preserves partial rows, and attributes per-page usage privately', async () => {
  const start = await prepared()
  const run = vi.fn(async () => Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output()) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }))
  const first = await extractImportPdfPage(db, store, actor, start.source.id, 2, 2, PNG, () => ({ settings, model: languageModel(settings, { run } as unknown as CloudflareAiBinding) }))
  expect(run).toHaveBeenCalledWith(settings.model, expect.objectContaining({ messages: expect.arrayContaining([
    expect.objectContaining({ role: 'user', content: expect.arrayContaining([
      expect.objectContaining({ type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }),
    ]) }),
  ]) }), expect.anything())
  expect(first).toMatchObject({ state: 'none', source: { version: 4 }, rows: [{ sourcePageNumber: 2, source: evidence }], pdf: { pages: [{ state: 'pending' }, { state: 'ready', attempts: 1, itemCount: 1 }] } })
  expect(first.pdf!.pages[1]).not.toHaveProperty('usageId')
  expect(first.pdf!.pages[1]).not.toHaveProperty('imageDigest')
  generate.mockRejectedValueOnce(new Error('Private cafe document text'))
  await expect(extract(start.source.id, 1, 4)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_EXTRACTION_FAILED' } })
  const partial = await getImportReview(db, actor, start.source.id)
  expect(partial.rows).toEqual(first.rows)
  expect(partial).toMatchObject({ state: 'failed', source: { version: 6 }, pdf: { pages: [{ state: 'failed', attempts: 1 }, { state: 'ready' }] } })
  const complete = await extract(start.source.id, 1, 6)
  expect(complete).toMatchObject({ state: 'ready', source: { version: 8, expiresAt: start.source.expiresAt }, pdf: { pages: [{ state: 'ready', attempts: 2 }, { state: 'ready' }] } })
  expect(complete.rows.map(r => r.sourcePageNumber)).toEqual([1, 2])
  expect(complete.rows[1]).toEqual(first.rows[0])
  expect(await usageRows()).toMatchObject([{ importSourceId: start.source.id, sourcePageNumber: 2, outcome: 'ok', inputTokens: 12 }, { sourcePageNumber: 1, outcome: 'error' }, { sourcePageNumber: 1, outcome: 'ok' }])
  const saved = await sourceRow(start.source.id)
  expect(saved.pdfReview!.pages[0]).toMatchObject({ imageDigest: expect.stringMatching(/^[a-f0-9]{64}$/), usageId: expect.any(String) })
  const metadata = JSON.stringify([await usageRows(), await db.select().from(auditEvents)])
  for (const secret of ['Coffee', '$2.50', 'private-menu', 'Private cafe']) expect(metadata).not.toContain(secret)
  expect(await db.select().from(menuItems)).toEqual([])
  expect(await db.select().from(assistantImportLeases)).toEqual([])
  expect(objects.size).toBe(1)
})

it('replays a completed page without model setup, charging, new row ids or lost corrections/receipts', async () => {
  const start = await prepared([1])
  const ready = await extract(start.source.id, 1, 2)
  const category = await createCategory(db, actor, { name: 'Drinks', description: '', parentId: null, availabilityRuleIds: [] })
  const corrected = await updateImportReviewRow(db, actor, start.source.id, ready.rows[0]!.id, { version: 4, draft: { ...ready.rows[0]!.draft, categoryId: category.id } })
  const receipt = await createImportDraft(db, actor, start.source.id, ready.rows[0]!.id, { version: corrected.source.version, confirmDuplicate: false }, 'pdf-page-draft')
  const latest = await getImportReview(db, actor, start.source.id)
  const setup = vi.fn(() => {
    throw new Error('must not set up a model')
  })
  expect(await extractImportPdfPage(db, store, actor, start.source.id, 1, 2, new Uint8Array(), setup)).toEqual(latest)
  expect(latest.rows[0]).toMatchObject({ sourcePageNumber: 1, createdItemId: receipt.itemId })
  expect(setup).not.toHaveBeenCalled()
  expect(generate).toHaveBeenCalledOnce()
  expect(await usageRows()).toHaveLength(1)
  expect(await db.select().from(menuItems)).toHaveLength(1)
})

it('refuses another cafe/creator and expired sources before private I/O or model setup', async () => {
  const start = await prepared()
  await ensureTenant(db, 'another-cafe')
  const other = await createAdmin(db)
  const setup = vi.fn(context)
  const read = vi.spyOn(store, 'get')
  for (const outsider of [{ ...actor, tenantId: 'another-cafe' }, { ...actor, userId: other.userId }]) {
    await expect(prepareImportPdf(db, outsider, start.source.id, { version: 2, pageNumbers: [1] })).rejects.toMatchObject({ statusCode: 404 })
    await expect(extractImportPdfPage(db, store, outsider, start.source.id, 1, 2, PNG, setup)).rejects.toMatchObject({ statusCode: 404 })
    await expect(finishImportPdf(db, outsider, start.source.id, { version: 2, confirmPartial: true })).rejects.toMatchObject({ statusCode: 404 })
  }
  await db.update(assistantImports).set({ expiresAt: new Date(0) }).where(eq(assistantImports.id, start.source.id))
  await expect(extract(start.source.id, 1, 2)).rejects.toMatchObject({ statusCode: 404 })
  expect(read).not.toHaveBeenCalled()
  expect(setup).not.toHaveBeenCalled()
  expect(await usageRows()).toEqual([])
})

it('refuses invalid/unselected/stale PNG pages before model setup or charging', async () => {
  const start = await prepared([1])
  const setup = vi.fn(context)
  const oversized = new Uint8Array(2 * 1024 * 1024 + 1)
  oversized.set(PNG)
  for (const bytes of [new Uint8Array(), oversized, PDF, PNG.slice(0, 8)]) {
    await expect(extractImportPdfPage(db, store, actor, start.source.id, 1, 2, bytes, setup)).rejects.toMatchObject({ statusCode: 422 })
  }
  for (const side of [1401, 9000]) {
    const huge = PNG.slice()
    new DataView(huge.buffer).setUint32(16, side)
    await expect(extractImportPdfPage(db, store, actor, start.source.id, 1, 2, huge, setup)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_PDF_PAGE_INVALID' } })
  }
  await expect(extract(start.source.id, 2, 2)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_PDF_PAGE_NOT_SELECTED' } })
  await expect(extract(start.source.id, 1, 1)).rejects.toMatchObject({ statusCode: 409 })
  expect(setup).not.toHaveBeenCalled()
  expect(await usageRows()).toEqual([])
  expect((await getImportReview(db, actor, start.source.id)).pdf!.pages[0]!.attempts).toBe(0)
  expect(() => checkPdfPageImage(PNG)).not.toThrow()
})

it('refuses missing configuration/storage before reserving a lease or changing attempts', async () => {
  const start = await prepared([1])
  await expect(extractImportPdfPage(db, store, actor, start.source.id, 1, 2, PNG, () => {
    throw new Error('not configured')
  })).rejects.toThrow('not configured')
  objects.clear()
  await expect(extract(start.source.id, 1, 2)).rejects.toMatchObject({ statusCode: 404 })
  expect(await usageRows()).toEqual([])
  expect(await db.select().from(assistantImportLeases)).toEqual([])
  expect((await sourceRow(start.source.id)).version).toBe(2)
})

it('caps three actual attempts per page and does not call a provider after the cap', async () => {
  const start = await prepared([1])
  generate.mockRejectedValue(new Error('private provider response'))
  for (const version of [2, 4, 6]) await expect(extract(start.source.id, 1, version)).rejects.toMatchObject({ statusCode: 502 })
  await expect(extract(start.source.id, 1, 8)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_PDF_PAGE_LIMIT' } })
  expect(generate).toHaveBeenCalledTimes(3)
  expect(await usageRows()).toHaveLength(3)
  expect((await getImportReview(db, actor, start.source.id)).pdf!.pages[0]).toMatchObject({ attempts: 3, state: 'failed' })
})

it('charges the existing daily limit per page, preserving successes and attempts when quota refuses a call', async () => {
  const start = await prepared()
  const limited = () => ({ ...context(), settings: { ...settings, dailyLimit: 1 } })
  const first = await extractImportPdfPage(db, store, actor, start.source.id, 1, 2, PNG, limited)
  await expect(extractImportPdfPage(db, store, actor, start.source.id, 2, 4, PNG, limited)).rejects.toMatchObject({ data: { code: 'AI_LIMIT_REACHED' } })
  const current = await getImportReview(db, actor, start.source.id)
  expect(current.rows).toEqual(first.rows)
  expect(current.pdf!.pages[1]).toMatchObject({ attempts: 0, state: 'failed', error: 'AI_LIMIT_REACHED' })
  expect(await usageRows()).toHaveLength(1)
  expect(generate).toHaveBeenCalledOnce()
  expect(await db.select().from(assistantImportLeases)).toEqual([])
})

it.each(['invalid', 'truncated', 'empty', 'over-total'])('keeps successful page evidence when the next output is %s', async (kind) => {
  const start = await prepared()
  const first = await extract(start.source.id, 1, 2)
  const invalid = kind === 'empty' ? output(0) : kind === 'over-total' ? output(50) : { ...output(), truncated: kind === 'truncated', ...(kind === 'invalid' ? { publish: true } : {}) }
  generate.mockResolvedValueOnce(completion(invalid))
  await expect(extract(start.source.id, 2, 4)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_RESULT_INVALID' } })
  const current = await getImportReview(db, actor, start.source.id)
  expect(current.rows).toEqual(first.rows)
  expect(current.state).toBe('failed')
  expect(await usageRows()).toMatchObject([{ outcome: 'ok' }, { outcome: 'error' }])
})

it('requires explicit nonempty partial finalization and preserves receipts after it', async () => {
  const start = await prepared()
  await expect(finishImportPdf(db, actor, start.source.id, { version: 2, confirmPartial: true })).rejects.toMatchObject({ data: { code: 'AI_IMPORT_PDF_EMPTY' } })
  const first = await extract(start.source.id, 1, 2)
  await expect(updateImportReviewRow(db, actor, start.source.id, first.rows[0]!.id, { version: 4, selected: false })).rejects.toMatchObject({ statusCode: 409 })
  await expect(createImportDraft(db, actor, start.source.id, first.rows[0]!.id, { version: 4, confirmDuplicate: false }, 'before-partial')).rejects.toMatchObject({ statusCode: 409 })
  await expect(finishImportPdf(db, actor, start.source.id, { version: 4 } as never)).rejects.toMatchObject({ statusCode: 400 })
  const ready = await finishImportPdf(db, actor, start.source.id, { version: 4, confirmPartial: true })
  expect(ready).toMatchObject({ state: 'ready', rows: first.rows, source: { version: 5 }, pdf: { pages: [{ state: 'ready' }, { state: 'skipped' }] } })
  await expect(extract(start.source.id, 2, 5)).rejects.toMatchObject({ statusCode: 409 })
  expect(await finishImportPdf(db, actor, start.source.id, { version: 4, confirmPartial: true })).toEqual(ready)
  expect(generate).toHaveBeenCalledOnce()
})

it('holds the creator lease through cancellation and prevents a late page from replacing an accepted partial result', async () => {
  const start = await prepared()
  const first = await extract(start.source.id, 1, 2)
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  generate.mockImplementationOnce(async () => {
    entered()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return completion()
  })
  const pending = extract(start.source.id, 2, 4)
  const assertion = expect(pending).rejects.toMatchObject({ data: { code: 'AI_IMPORT_CANCELLED' } })
  await started
  await expect(finishImportPdf(db, actor, start.source.id, { version: 5, confirmPartial: true })).rejects.toMatchObject({ statusCode: 409 })
  const cancelled = await cancelImportExtraction(db, actor, start.source.id, 5)
  expect(cancelled).toMatchObject({ state: 'failed', rows: first.rows, pdf: { pages: [{ state: 'ready' }, { state: 'failed', error: 'AI_IMPORT_CANCELLED' }] } })
  await expect(extract(start.source.id, 2, 6)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_BUSY' } })
  const ready = await finishImportPdf(db, actor, start.source.id, { version: 6, confirmPartial: true })
  expect(await db.select().from(assistantImportLeases)).toHaveLength(1)
  release()
  await assertion
  expect(await getImportReview(db, actor, start.source.id)).toEqual(ready)
  expect(await usageRows()).toMatchObject([{ outcome: 'ok' }, { importSourceId: start.source.id, sourcePageNumber: 2, outcome: 'error' }])
  expect(await db.select().from(assistantImportLeases)).toEqual([])
})

it.each(['discard', 'expiry'])('refuses a late result after source %s and erases private page data with the source', async (reason) => {
  const start = await prepared([1])
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  generate.mockImplementationOnce(async () => {
    entered()
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return completion()
  })
  const pending = extract(start.source.id, 1, 2)
  const assertion = expect(pending).rejects.toMatchObject({ data: { code: 'AI_IMPORT_CANCELLED' } })
  await started
  if (reason === 'discard') await discardImportSource(db, store, actor, start.source.id, 3)
  else {
    await db.update(assistantImports).set({ expiresAt: new Date(0) }).where(eq(assistantImports.id, start.source.id))
    await db.update(assistantImportObjects).set({ expiresAt: new Date(0) })
    await purgeImportSources(db, store)
  }
  release()
  await assertion
  expect(await db.select().from(assistantImports)).toEqual([])
  expect(await db.select().from(assistantImportObjects)).toEqual([])
  expect(objects.size).toBe(0)
  expect(await usageRows()).toMatchObject([{ outcome: 'error', sourcePageNumber: 1 }])
})

it('uses atomic source versions when two page commands race and refuses pre-abort without work', async () => {
  const start = await prepared()
  const abort = new AbortController()
  abort.abort()
  await expect(extract(start.source.id, 1, 2, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  const results = await Promise.allSettled([extract(start.source.id, 1, 2), extract(start.source.id, 2, 2)])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
  expect(generate).toHaveBeenCalledOnce()
  expect(await usageRows()).toHaveLength(1)
  expect((await getImportReview(db, actor, start.source.id)).rows).toHaveLength(1)
})

it('does not let a stale prepared write replace a newer selection', async () => {
  const source = await upload()
  await prepareImportPdf(db, actor, source.id, { version: 1, pageNumbers: [1] })
  await db.batch([pdfRepo.prepareStatement(db, actor, source.id, 1, { pages: [{ pageNumber: 2, state: 'pending', attempts: 0, itemCount: 0, error: null }] }, new Date())])
  expect((await getImportReview(db, actor, source.id)).pdf!.pages.map(p => p.pageNumber)).toEqual([1])
})

it('accepts exactly fifty combined rows and rejects an over-byte aggregate without losing the first page', async () => {
  const first = await prepared()
  generate.mockResolvedValueOnce(completion(output(40)))
  await extract(first.source.id, 1, 2)
  generate.mockResolvedValueOnce(completion(output(10)))
  expect((await extract(first.source.id, 2, 4)).rows).toHaveLength(50)
  const second = await prepared()
  const large = { ...output(8), items: output(8).items.map(item => ({ ...item, description: 'D'.repeat(500), prices: Array.from({ length: 20 }, () => ({ ...item.prices[0]!, evidence: 'E'.repeat(150) })) })) }
  generate.mockResolvedValueOnce(completion(large))
  const retained = await extract(second.source.id, 1, 2)
  generate.mockResolvedValueOnce(completion(large))
  await expect(extract(second.source.id, 2, 4)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_RESULT_INVALID' } })
  expect((await getImportReview(db, actor, second.source.id)).rows).toEqual(retained.rows)
  expect((await usageRows()).at(-1)).toMatchObject({ outcome: 'error' })
})

it('keeps per-page quotas and leases independent for the same creator in two cafes', async () => {
  const first = await prepared([1])
  const limited = () => ({ ...context(), settings: { ...settings, dailyLimit: 1 } })
  await extractImportPdfPage(db, store, actor, first.source.id, 1, 2, PNG, limited)
  await ensureTenant(db, 'pdf-other-cafe')
  const otherActor = { ...actor, tenantId: 'pdf-other-cafe' }
  const second = await uploadImportSource(db, store, otherActor, { type: 'application/pdf', data: PDF, fileName: 'other-private.pdf' })
  await prepareImportPdf(db, otherActor, second.id, { version: 1, pageNumbers: [1] })
  expect((await extractImportPdfPage(db, store, otherActor, second.id, 1, 2, PNG, limited)).state).toBe('ready')
  expect(await usageRows()).toMatchObject([{ tenantId: actor.tenantId, importSourceId: first.source.id }, { tenantId: otherActor.tenantId, importSourceId: second.id }])
})

it('recovers an expired attempt without letting its old worker fail a new page or release the new lease', async () => {
  const start = await prepared()
  let oldRelease!: () => void
  let oldEntered!: () => void
  const oldStarted = new Promise<void>((resolve) => {
    oldEntered = resolve
  })
  generate.mockImplementationOnce(async () => {
    oldEntered()
    await new Promise<void>((resolve) => {
      oldRelease = resolve
    })
    return completion()
  })
  const old = extract(start.source.id, 1, 2)
  const oldAssertion = expect(old).rejects.toMatchObject({ data: { code: 'AI_IMPORT_CANCELLED' } })
  await oldStarted
  await db.update(assistantImports).set({ extractionDeadline: new Date(0) }).where(eq(assistantImports.id, start.source.id))
  await db.update(assistantImportLeases).set({ deadline: new Date(0) })
  expect(await getImportReview(db, actor, start.source.id)).toMatchObject({ state: 'failed', pdf: { pages: [{ state: 'failed', error: 'AI_IMPORT_INTERRUPTED' }, { state: 'pending' }] } })
  const recovered = await extract(start.source.id, 1, 3)
  let newRelease!: () => void
  let newEntered!: () => void
  const newStarted = new Promise<void>((resolve) => {
    newEntered = resolve
  })
  generate.mockImplementationOnce(async () => {
    newEntered()
    await new Promise<void>((resolve) => {
      newRelease = resolve
    })
    return completion()
  })
  const next = extract(start.source.id, 2, 5)
  await newStarted
  oldRelease()
  await oldAssertion
  const current = await getImportReview(db, actor, start.source.id)
  expect(current).toMatchObject({ state: 'processing', source: { version: 6 }, rows: recovered.rows, pdf: { pages: [{ state: 'ready', attempts: 2 }, { state: 'processing' }] } })
  expect(await db.select().from(assistantImportLeases)).toHaveLength(1)
  newRelease()
  expect((await next).state).toBe('ready')
  expect(await db.select().from(assistantImportLeases)).toEqual([])
})
