import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, expect, it, vi } from 'vitest'
import * as v from 'valibot'
import type { Actor } from '#server/features/identity'
import type { Db } from '#server/utils/batch'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { cancelImportExtraction, discardImportSource, extractImportSource, getImportReview, importSettingsFrom, languageModel, purgeImportSources, updateImportReviewRow, uploadImportSource } from '#server/features/assistant'
import type { CloudflareAiBinding, ImportObjectStore } from '#server/features/assistant'
import { assistantImportLeases, assistantImports, assistantUsage } from '#server/features/assistant/assistant.schema'
import { auditEvents } from '#server/features/platform/platform.schema'
import { menuItems } from '#server/features/menu/menu.schema'
import { toReviewRows } from '#server/features/assistant/assistant-extraction'
import * as repo from '#server/features/assistant/assistant-review.repository'
import { updateAssistantImportRowSchema } from '#shared/contracts/assistant-import'

const PNG = new Uint8Array(readFileSync(new URL('../eval/fixtures/columns-and-sizes.png', import.meta.url)))
const evidence = { name: 'Coffee', description: null, category: 'Drinks', prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] }
const output = () => ({ items: [structuredClone(evidence)], truncated: false })
const usage = { inputTokens: { total: 12, noCache: 4, cacheRead: 8, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } }
const completion = (result = output()) => ({ content: [{ type: 'text' as const, text: JSON.stringify(result) }], finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [] })
type Generate = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>['doGenerate']
type GenerateFunction = Extract<Generate, (...args: never[]) => unknown>
let db: Db
let actor: Actor
let doGenerate: ReturnType<typeof vi.fn<GenerateFunction>>
let objects: Map<string, Blob>
let store: ImportObjectStore
const settings = importSettingsFrom({ importModel: '@cf/google/gemma-4-26b-a4b-it', dailyLimit: 2 })
const model = () => new MockLanguageModelV4({ doGenerate })
const upload = (type = 'image/png', data = PNG) => uploadImportSource(db, store, actor, { type, data, fileName: 'private-source.png' })
const extract = (id: string, version = 1, signal?: AbortSignal) => extractImportSource(db, store, actor, id, version, () => ({ settings, model: model() }), signal)
const usageRows = () => db.select().from(assistantUsage)
const sourceRows = () => db.select().from(assistantImports)

beforeEach(async () => {
  db = await createTestDb()
  actor = { ...(await createAdmin(db)), tenantId: TEST_TENANT, role: 'owner' }
  objects = new Map()
  store = { driver: { name: 'fs' }, put: async (key, bytes, options) => {
    objects.set(key, new Blob([bytes], { type: options.contentType }))
  }, get: async key => objects.get(key) ?? null, del: async (key) => { objects.delete(key) } }
  doGenerate = vi.fn<GenerateFunction>(async () => completion())
})

it('uses a separate binding-only model with no default or external key', () => {
  expect(settings).toMatchObject({ provider: 'cloudflare', apiKey: '', baseUrl: null, dailyLimit: 2 })
  for (const importModel of ['', 'gpt-example', undefined]) expect(() => importSettingsFrom({ importModel })).toThrow()
})

it('extracts through the actual installed binding adapter and records only metadata usage/audit', async () => {
  const source = await upload()
  const run = vi.fn(async () => Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(output()) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }))
  const review = await extractImportSource(db, store, actor, source.id, 1, () => ({ settings, model: languageModel(settings, { run } as unknown as CloudflareAiBinding) }))
  expect(review).toMatchObject({ state: 'ready', error: null, retryAt: null, source: { version: 3, expiresAt: source.expiresAt } })
  expect(review.rows[0]).toMatchObject({ source: evidence, selected: true, draft: { name: 'Coffee', categoryId: null, variations: [{ valueIds: [], priceMinor: 250, status: 'active' }] } })
  expect(await getImportReview(db, actor, source.id)).toEqual(review)
  expect(run).toHaveBeenCalledOnce()
  expect(run).toHaveBeenCalledWith(settings.model, expect.objectContaining({ response_format: { type: 'json_schema', json_schema: expect.objectContaining({ name: 'private_menu_transcription' }) } }), expect.anything())
  expect(await usageRows()).toMatchObject([{ feature: 'menu_import', provider: 'cloudflare', inputTokens: 12, outputTokens: 5, outcome: 'ok' }])
  const audit = await db.select().from(auditEvents)
  expect(JSON.stringify(audit)).not.toContain('Coffee')
  expect(JSON.stringify(audit)).not.toContain('$2.50')
  expect(JSON.stringify(audit)).not.toContain('private-source')
  expect(await db.select().from(menuItems)).toEqual([])
  expect(await db.select().from(assistantImportLeases)).toEqual([])
})

it('sends inline bounded bytes, schema, cancellation and no tools to the SDK', async () => {
  const source = await upload()
  await extract(source.id)
  const request = doGenerate.mock.calls[0]![0]
  expect(request.prompt.at(-1)!.content).toContainEqual(expect.objectContaining({ type: 'file', mediaType: 'image/png', data: { type: 'data', data: PNG } }))
  expect(request.tools).toBeUndefined()
  expect(request.abortSignal).toBeInstanceOf(AbortSignal)
  expect(request.maxOutputTokens).toBe(8192)
  expect(request.responseFormat).toMatchObject({ type: 'json', schema: { additionalProperties: false } })
  expect((await usageRows())[0]).toMatchObject({ cachedInputTokens: 8 })
})

it('preserves sizes/KHR/unknown evidence and leaves their draft mapping unresolved', () => {
  const rows = toReviewRows({ items: [{ ...evidence, prices: [{ label: 'Large', amount: '10000', currency: 'KHR', evidence: '10,000 riel' }, { label: 'Small', amount: null, currency: 'unknown', evidence: null }] }], truncated: false })
  expect(rows[0]!.source.prices[0]!.amount).toBe('10000')
  expect(rows[0]!.source.flags).toEqual(['missing-price', 'ambiguous-currency'])
  expect(rows[0]!.draft.variations).toEqual([])
  expect(rows[0]!.draft.categoryId).toBeNull()
})
it.each([['2.505', null], ['02.5000', 250], ['0.00', 0], ['1001', null]])('prefills exact USD %s as %s cents without rounding', (amount, cents) => {
  const rows = toReviewRows({ items: [{ ...evidence, prices: [{ ...evidence.prices[0], amount }] }], truncated: false })
  expect(rows[0]!.draft.variations[0]!.priceMinor).toBe(cents)
})

it.each([
  { items: [], truncated: false }, { ...output(), publish: true }, { ...output(), truncated: true },
  { items: [{ ...evidence, name: ' \t\n' }], truncated: false },
  { items: [{ ...evidence, prices: [{ ...evidence.prices[0], amount: '-1' }] }], truncated: false },
  { items: [{ ...evidence, prices: [{ ...evidence.prices[0], evidence: null }] }], truncated: false },
  { items: Array.from({ length: 51 }, () => evidence), truncated: false },
])('rejects unusable/invented command/truncated provider output with safe codes and charged usage (%j)', async (invalid) => {
  const source = await upload()
  doGenerate.mockResolvedValueOnce({ ...completion(), content: [{ type: 'text', text: JSON.stringify(invalid) }] })
  await expect(extract(source.id)).rejects.toMatchObject({ statusCode: 502, data: { code: 'AI_IMPORT_RESULT_INVALID' } })
  expect(await getImportReview(db, actor, source.id)).toMatchObject({ state: 'failed', error: 'AI_IMPORT_RESULT_INVALID', rows: [] })
  expect(await usageRows()).toMatchObject([{ outcome: 'error', inputTokens: 12, outputTokens: 5 }])
  expect(doGenerate).toHaveBeenCalledOnce()
})

it.each([['image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], ['application/pdf', new TextEncoder().encode('%PDF-1.7\nfixture')]])('refuses invalid image headers or PDF processing before charging (%s)', async (type, data) => {
  const source = await upload(type, data)
  await expect(extract(source.id)).rejects.toMatchObject({ statusCode: 422 })
  expect(doGenerate).not.toHaveBeenCalled()
  expect(await usageRows()).toEqual([])
  expect(await getImportReview(db, actor, source.id)).toMatchObject({ state: 'none', source: { version: 1 } })
})
it('bounds image dimensions/pixels before inference', async () => {
  const huge = PNG.slice()
  new DataView(huge.buffer).setUint32(16, 9000)
  const source = await upload('image/png', huge)
  await expect(extract(source.id)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_IMAGE_INVALID' } })
  expect(await usageRows()).toEqual([])
  expect(doGenerate).not.toHaveBeenCalled()
})

it('refuses wrong cafe/creator before reading storage or inference', async () => {
  const source = await upload()
  await ensureTenant(db, 'other-cafe')
  const other = await createAdmin(db)
  for (const outsider of [{ ...actor, tenantId: 'other-cafe' }, { ...actor, userId: other.userId }]) {
    await expect(getImportReview(db, outsider, source.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(extractImportSource(db, store, outsider, source.id, 1, () => ({ settings, model: model() }))).rejects.toMatchObject({ statusCode: 404 })
    await expect(updateImportReviewRow(db, outsider, source.id, crypto.randomUUID(), { version: 1, selected: false })).rejects.toMatchObject({ statusCode: 404 })
    await expect(cancelImportExtraction(db, outsider, source.id, 1)).rejects.toMatchObject({ statusCode: 404 })
  }
  expect(await usageRows()).toEqual([])
  expect(doGenerate).not.toHaveBeenCalled()
})

it('saves incomplete corrections and exclusion, preserves immutable evidence/TTL and rejects stale edits', async () => {
  const source = await upload()
  const review = await extract(source.id)
  const row = review.rows[0]!
  const edited = await updateImportReviewRow(db, actor, source.id, row.id, { version: 3, selected: false, draft: { ...row.draft, name: '', description: 'Owner correction', variations: [] } })
  expect(edited).toMatchObject({ source: { version: 4, expiresAt: source.expiresAt }, rows: [{ selected: false, source: evidence, draft: { name: '', description: 'Owner correction', categoryId: null, variations: [] } }] })
  expect(await getImportReview(db, actor, source.id)).toEqual(edited)
  await expect(updateImportReviewRow(db, actor, source.id, row.id, { version: 3, selected: true })).rejects.toMatchObject({ statusCode: 409, data: { code: 'VERSION_CONFLICT' } })
  await expect(discardImportSource(db, store, actor, source.id, 3)).rejects.toMatchObject({ statusCode: 409 })
  await expect(extract(source.id, 4)).rejects.toMatchObject({ statusCode: 409, data: { code: 'INVALID_STATE' } })
  expect(doGenerate).toHaveBeenCalledOnce()
  expect(v.safeParse(updateAssistantImportRowSchema, { version: 4, source: evidence }).success).toBe(false)
  await expect(updateImportReviewRow(db, actor, source.id, row.id, { version: 4, selected: true, source: evidence } as never)).rejects.toMatchObject({ statusCode: 400 })
})

it('two racing row edits cannot overwrite each other or commit a losing audit', async () => {
  const source = await upload()
  const review = await extract(source.id)
  const before = await db.select().from(auditEvents)
  const results = await Promise.allSettled([true, false].map(selected => updateImportReviewRow(db, actor, source.id, review.rows[0]!.id, { version: 3, selected })))
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect((await db.select().from(auditEvents)).length - before.length).toBe(1)
  expect((await getImportReview(db, actor, source.id)).source.version).toBe(4)
})

it('bounds one active extraction per creator/cafe, including races, without charging the loser', async () => {
  const one = await upload()
  const two = await upload()
  const race = await Promise.allSettled([extract(one.id), extract(two.id)])
  expect(race.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(race.find(r => r.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } })
  expect(doGenerate).toHaveBeenCalledOnce()
  expect(await usageRows()).toHaveLength(1)
})

it('keeps the lease during cancel/discard and refuses the late output, with no menu writes', async () => {
  const source = await upload()
  const second = await upload()
  let answer!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    answer = resolve
  })
  doGenerate.mockImplementationOnce(async () => {
    entered()
    await waiting
    return completion()
  })
  const pending = extract(source.id).catch(error => error)
  await started
  const processing = await getImportReview(db, actor, source.id)
  expect(processing).toMatchObject({ state: 'processing', rows: [], source: { version: 2 } })
  const cancelled = await cancelImportExtraction(db, actor, source.id, 2)
  expect(cancelled).toMatchObject({ state: 'failed', error: 'AI_IMPORT_CANCELLED', source: { version: 3 } })
  expect(cancelled.retryAt).not.toBeNull()
  await expect(extract(second.id)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_BUSY' } })
  await discardImportSource(db, store, actor, source.id, 3)
  await expect(extract(second.id)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_BUSY' } })
  answer()
  expect(await pending).toMatchObject({ statusCode: 409 })
  expect(await usageRows()).toMatchObject([{ outcome: 'error', inputTokens: 12 }])
  expect(await db.select().from(assistantImportLeases)).toEqual([])
  expect(await db.select().from(menuItems)).toEqual([])
})

it('a crash lease expires, retry replaces the attempt, and an old worker cannot finish/fail it', async () => {
  const source = await upload()
  await db.update(assistantImports).set({ reviewState: 'processing', extractionId: 'old', extractionDeadline: new Date(0), version: 2 }).where(eq(assistantImports.id, source.id))
  await db.insert(assistantImportLeases).values({ tenantId: actor.tenantId, userId: actor.userId, extractionId: 'old', deadline: new Date(0) })
  expect(await getImportReview(db, actor, source.id)).toMatchObject({ state: 'failed', error: 'AI_IMPORT_INTERRUPTED', source: { version: 2 } })
  const review = await extract(source.id, 2)
  expect(review).toMatchObject({ state: 'ready', source: { version: 4 } })
  await repo.failExtraction(db, actor, source.id, 'old', 'AI_IMPORT_EXTRACTION_FAILED')
  expect(await getImportReview(db, actor, source.id)).toEqual(review)
})

it('reuses the owner/cafe daily counter, safely records quota failures, and does not retry', async () => {
  const source = await upload()
  doGenerate.mockRejectedValue(Object.assign(new Error('secret source provider body'), { statusCode: 429 }))
  for (const version of [1, 3]) await expect(extract(source.id, version)).rejects.toMatchObject({ statusCode: 429, data: { code: 'AI_CAPACITY_REACHED' } })
  await expect(extract(source.id, 5)).rejects.toMatchObject({ statusCode: 429, data: { code: 'AI_LIMIT_REACHED' } })
  expect(doGenerate).toHaveBeenCalledTimes(2)
  expect(await usageRows()).toHaveLength(2)
  expect(await getImportReview(db, actor, source.id)).toMatchObject({ state: 'failed', error: 'AI_LIMIT_REACHED', source: { version: 7 } })
})

it('pre-abort does not reserve usage and request abort cannot save a late result', async () => {
  const source = await upload()
  const controller = new AbortController()
  controller.abort()
  await expect(extract(source.id, 1, controller.signal)).rejects.toThrow()
  expect(await usageRows()).toEqual([])
  const during = new AbortController()
  doGenerate.mockImplementationOnce(async () => {
    during.abort()
    return completion()
  })
  await expect(extract(source.id, 1, during.signal)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_CANCELLED' } })
  expect(await getImportReview(db, actor, source.id)).toMatchObject({ state: 'failed', rows: [] })
})

it('expiry/discard erase the persisted review and do not extend source retention', async () => {
  const source = await upload()
  await extract(source.id)
  await db.update(assistantImports).set({ expiresAt: new Date(0) }).where(eq(assistantImports.id, source.id))
  await expect(getImportReview(db, actor, source.id)).rejects.toMatchObject({ statusCode: 404 })
  await purgeImportSources(db, store, { now: new Date(Date.parse(source.expiresAt) + 1) })
  expect(await sourceRows()).toEqual([])
  const second = await upload()
  await extract(second.id)
  await discardImportSource(db, store, actor, second.id, 3)
  expect(await sourceRows()).toEqual([])
})

it('an older worker finishing during a newer attempt cannot replace/fail it or release its lease', async () => {
  const source = await upload()
  const now = Date.now()
  vi.useFakeTimers({ toFake: ['Date'] })
  let oldAnswer!: () => void
  let newAnswer!: () => void
  let enteredOld!: () => void
  let enteredNew!: () => void
  const oldEntered = new Promise<void>((r) => {
    enteredOld = r
  })
  const newEntered = new Promise<void>((r) => {
    enteredNew = r
  })
  const oldWait = new Promise<void>((r) => {
    oldAnswer = r
  })
  const newWait = new Promise<void>((r) => {
    newAnswer = r
  })
  doGenerate.mockImplementationOnce(async () => {
    enteredOld()
    await oldWait
    return completion()
  })
  doGenerate.mockImplementationOnce(async () => {
    enteredNew()
    await newWait
    return completion()
  })
  try {
    const old = extract(source.id).catch(e => e)
    await oldEntered
    vi.setSystemTime(now + 91_000)
    const fresh = extract(source.id, 2)
    await newEntered
    oldAnswer()
    expect(await old).toMatchObject({ statusCode: 409 })
    expect(await getImportReview(db, actor, source.id)).toMatchObject({ state: 'processing', source: { version: 3 }, rows: [] })
    expect(await db.select().from(assistantImportLeases)).toHaveLength(1)
    newAnswer()
    expect(await fresh).toMatchObject({ state: 'ready', source: { version: 4 } })
    expect((await usageRows()).map(r => r.outcome)).toEqual(['error', 'ok'])
  }
  finally {
    oldAnswer()
    newAnswer()
    vi.useRealTimers()
  }
})

it('another cafe has an independent processing lease for the same owner', async () => {
  const source = await upload()
  await db.insert(assistantImportLeases).values({ tenantId: actor.tenantId, userId: actor.userId, extractionId: 'other-running', deadline: new Date(Date.now() + 90_000) })
  await ensureTenant(db, 'other-cafe')
  const other = { ...actor, tenantId: 'other-cafe' }
  const uploaded = await uploadImportSource(db, store, other, { type: 'image/png', data: PNG, fileName: 'menu.png' })
  await expect(extractImportSource(db, store, other, uploaded.id, 1, () => ({ settings, model: model() }))).resolves.toMatchObject({ state: 'ready' })
  expect(await getImportReview(db, actor, source.id)).toMatchObject({ state: 'none' })
})

it('reports real adapter capacity errors without exposing the provider response body', async () => {
  const source = await upload()
  const run = vi.fn(async () => Response.json({ error: 'source content secret' }, { status: 429 }))
  await expect(extractImportSource(db, store, actor, source.id, 1, () => ({ settings, model: languageModel(settings, { run } as unknown as CloudflareAiBinding) }))).rejects.toMatchObject({ statusCode: 429, data: { code: 'AI_CAPACITY_REACHED' } })
  expect(run).toHaveBeenCalledOnce()
  expect(JSON.stringify(await sourceRows())).not.toContain('source content secret')
  expect(await usageRows()).toMatchObject([{ outcome: 'error', inputTokens: null }])
})

it('bounds serialized extracted evidence, even when each individual field is valid', () => {
  const many = { items: Array.from({ length: 50 }, () => ({ ...evidence, prices: Array.from({ length: 20 }, () => ({ ...evidence.prices[0], evidence: 'x'.repeat(160) })) })), truncated: false }
  expect(() => toReviewRows(many)).toThrow()
})

it('rejects a token-truncated response even when it happens to contain valid JSON', async () => {
  const source = await upload()
  doGenerate.mockResolvedValueOnce({ ...completion(), finishReason: { unified: 'length', raw: 'length' } })
  await expect(extract(source.id)).rejects.toMatchObject({ data: { code: 'AI_IMPORT_RESULT_INVALID' } })
  expect(await usageRows()).toMatchObject([{ outcome: 'error', inputTokens: 12 }])
})
