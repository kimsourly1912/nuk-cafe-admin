import { describe, expect, it, vi } from 'vitest'
import type { AssistantImportDraft, AssistantImportReview, CreateAssistantImportDraftResult } from '#shared/contracts/assistant-import'
import type { OptionSet } from '#shared/contracts/menu-options'
import type { ApiFetch } from '~/utils/api-fetch'
import { ApiError } from '~/utils/api-error'
import { importDraftCommands, importDraftProblem, importFileProblem, importGrid } from '../utils/import'

const sourceId = crypto.randomUUID()
const rowId = crypto.randomUUID()
const categoryId = crypto.randomUUID()
const itemId = crypto.randomUUID()
const draft = (): AssistantImportDraft => ({ name: 'Coffee', description: '', categoryId, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 250, status: 'active' }], modifierGroups: [], availabilityRuleIds: [] })
const review = (version = 3, createdItemId?: string): AssistantImportReview => ({
  source: { id: sourceId, fileName: 'Private menu.png', mimeType: 'image/png', byteSize: 100, version, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100000).toISOString() },
  state: 'ready', retryAt: null, error: null,
  rows: [{ id: rowId, selected: true, createdItemId, draft: draft(), source: { name: 'Coffee', description: null, category: 'Drinks', prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] } }],
})
const result = (): CreateAssistantImportDraftResult => ({ sourceId, rowId, itemId, version: 4, alreadyCreated: false, replayed: false })

describe('import admission and correction', () => {
  it('rejects empty, unsupported and over-limit files before upload', () => {
    expect(importFileProblem({ size: 1, type: 'image/svg+xml' })).toMatch('JPEG')
    expect(importFileProblem({ size: 0, type: 'image/png' })).toMatch('empty')
    expect(importFileProblem({ size: 5 * 1024 * 1024 + 1, type: 'image/png' })).toMatch('5 MB')
    expect(importFileProblem({ size: 5 * 1024 * 1024, type: 'application/pdf' })).toBeUndefined()
  })
  it('requires names, categories and a priced sellable version before creation', () => {
    expect(importDraftProblem(draft())).toBeUndefined()
    expect(importDraftProblem({ ...draft(), name: '' })).toBeTruthy()
    expect(importDraftProblem({ ...draft(), categoryId: null })).toBeTruthy()
    expect(importDraftProblem({ ...draft(), variations: [{ valueIds: [], priceMinor: null, status: 'active' }] })).toBeTruthy()
    expect(importDraftProblem({ ...draft(), variations: [{ valueIds: [], priceMinor: 250, status: 'disabled' }] })).toBeTruthy()
  })
  it('keeps the saved grid for unavailable libraries and oversized combinations', () => {
    const state = draft()
    const set = (id: string, count: number, status = 'active') => ({ id, status, values: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, status: 'active' })) }) as OptionSet
    expect(importGrid(state, ['a', 'b', 'c'], [set('a', 1), set('b', 1), set('c', 1)])).toBe(state.variations)
    expect(importGrid(state, ['a', 'b'], [set('a', 21), set('b', 20)])).toBe(state.variations)
    expect(importGrid(state, ['a'], [set('a', 1, 'archived')])).toBe(state.variations)
  })
  it('preserves matching grid prices and leaves new combinations unpriced', () => {
    const set = { id: 'sizes', status: 'active', values: [{ id: 's', status: 'active' }, { id: 'l', status: 'active' }, { id: 'gone', status: 'archived' }] } as OptionSet
    const state = { ...draft(), optionSetIds: ['sizes'], variations: [{ valueIds: ['s'], priceMinor: 250, status: 'active' as const }] }
    expect(importGrid(state, ['sizes'], [set])).toEqual([{ valueIds: ['s'], priceMinor: 250, status: 'active' }, { valueIds: ['l'], priceMinor: null, status: 'active' }])
    expect(importGrid(state, [], [set])).toEqual([{ valueIds: [], priceMinor: null, status: 'active' }])
    expect(importGrid(state, ['missing'], [set])).toEqual(state.variations)
  })
})

describe('draft command coordination', () => {
  it('resumes before creation, sends only metadata and refreshes after a replay', async () => {
    const calls: { path: string, body?: unknown }[] = []
    const fetch = vi.fn(async (path, options) => {
      calls.push({ path, body: options?.body })
      if (options?.method === 'POST') return { ...result(), replayed: true, version: 2 }
      return review(calls.length === 1 ? 3 : 7)
    }) as unknown as ApiFetch
    const accept = vi.fn()
    const command = importDraftCommands(fetch, accept, () => true)
    expect(await command({ sourceId, rowId })).toMatchObject({ replayed: true, version: 2 })
    expect(calls[1]!.body).toEqual({ version: 3, confirmDuplicate: false })
    expect(JSON.stringify(calls[1])).not.toContain('Coffee')
    expect(accept.mock.calls.at(-1)![0].source.version).toBe(7)
  })
  it('reuses the identical key and body after an uncertain response, despite a newer resume version', async () => {
    const sent: { body: unknown, key: string }[] = []
    let version = 3
    const fetch = vi.fn(async (_path, options) => {
      if (!options?.method) return review(version)
      sent.push({ body: options.body, key: new Headers(options.headers).get('Idempotency-Key')! })
      if (sent.length === 1) throw new ApiError('Offline', { kind: 'network', status: 0 })
      return { ...result(), replayed: true }
    }) as unknown as ApiFetch
    const command = importDraftCommands(fetch, () => {}, () => true)
    await expect(command({ sourceId, rowId })).rejects.toMatchObject({ kind: 'network' })
    version = 5
    await command({ sourceId, rowId })
    expect(sent[0]).toEqual(sent[1])
    expect(sent[1]!.body).toEqual({ version: 3, confirmDuplicate: false })
  })
  it('refreshes the version and action after a definitive validation failure', async () => {
    const sent: { body: unknown, key: string }[] = []
    let version = 3
    const fetch = vi.fn(async (_path, options) => {
      if (!options?.method) return review(version)
      sent.push({ body: options.body, key: new Headers(options.headers).get('Idempotency-Key')! })
      if (sent.length === 1) throw new ApiError('Duplicate', { kind: 'conflict', status: 409, code: 'ITEM_NAME_EXISTS' })
      return result()
    }) as unknown as ApiFetch
    const command = importDraftCommands(fetch, () => {}, () => true)
    await expect(command({ sourceId, rowId })).rejects.toMatchObject({ code: 'ITEM_NAME_EXISTS' })
    version = 5
    await command({ sourceId, rowId, confirmDuplicate: true })
    expect(sent[1]!.body).toEqual({ version: 5, confirmDuplicate: true })
    expect(sent[1]!.key).not.toBe(sent[0]!.key)
  })
  it('uses a resumed receipt without issuing another menu write', async () => {
    const fetch = vi.fn(async () => review(6, itemId)) as unknown as ApiFetch
    const command = importDraftCommands(fetch, () => {}, () => true)
    expect(await command({ sourceId, rowId })).toMatchObject({ itemId, alreadyCreated: true, version: 6 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not start writes when the page/source/session changes during resume', async () => {
    let active = true
    const fetch = vi.fn(async () => {
      active = false
      return review()
    }) as unknown as ApiFetch
    const accept = vi.fn()
    const command = importDraftCommands(fetch, accept, () => active)
    await expect(command({ sourceId, rowId })).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(accept).not.toHaveBeenCalled()
  })
  it('does not expose a late result to a different source/session', async () => {
    let active = true
    const fetch = vi.fn(async (_path, options) => {
      if (options?.method) {
        active = false
        return result()
      }
      return review()
    }) as unknown as ApiFetch
    const accept = vi.fn()
    const command = importDraftCommands(fetch, accept, () => active)
    await expect(command({ sourceId, rowId })).rejects.toMatchObject({ kind: 'aborted' })
    expect(accept).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
