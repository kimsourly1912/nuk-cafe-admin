import * as v from 'valibot'
import type { AssistantImportDraft, AssistantImportReview, CreateAssistantImportDraftInput, CreateAssistantImportDraftResult } from '#shared/contracts/assistant-import'
import { ASSISTANT_IMPORT_MAX_BYTES, ASSISTANT_IMPORT_TYPES } from '#shared/contracts/assistant-import'
import { createItemSchema, MAX_ITEM_OPTION_SETS } from '#shared/contracts/menu-items'
import type { OptionSet } from '#shared/contracts/menu-options'
import type { ApiFetch } from '~/utils/api-fetch'
import { ApiError } from '~/utils/api-error'

export const IMPORT_BASE = '/admin/assistant/imports'

export function importFileProblem(file: Pick<File, 'size' | 'type'>): string | undefined {
  if (!(ASSISTANT_IMPORT_TYPES as readonly string[]).includes(file.type)) return 'Choose a JPEG, PNG, WebP or PDF.'
  if (!file.size) return 'This file is empty.'
  if (file.size > ASSISTANT_IMPORT_MAX_BYTES) return 'Choose a file no larger than 5 MB.'
}

/** Readiness is a shape check only; the server validates current library relationships. */
export function importDraftProblem(draft: AssistantImportDraft): string | undefined {
  const parsed = v.safeParse(createItemSchema, { ...draft, imageId: null })
  if (!parsed.success) return parsed.issues[0]?.message ?? 'Check the required fields.'
  if (!draft.variations.some(c => c.status === 'active' && c.priceMinor !== null)) return 'Set a price for at least one version.'
}

/** Rebuild from chosen active library values; preserve only prices of identical combinations. */
export function importGrid(draft: AssistantImportDraft, ids: string[], library: OptionSet[]): AssistantImportDraft['variations'] {
  if (ids.length > MAX_ITEM_OPTION_SETS) return draft.variations
  const sets = ids.map(id => library.find(s => s.id === id && s.status === 'active'))
  if (sets.some(s => !s)) return draft.variations
  let combinations: string[][] = [[]]
  for (const set of sets) combinations = combinations.flatMap(c => set!.values.filter(value => value.status === 'active').map(value => [...c, value.id]))
  if (combinations.length > 400) return draft.variations
  const keyOf = (ids: string[]) => [...ids].sort().join(',')
  return combinations.map((valueIds) => {
    const prior = draft.variations.find(c => keyOf(c.valueIds) === keyOf(valueIds))
    return { valueIds, priceMinor: prior?.priceMinor ?? null, status: prior?.status ?? 'active' }
  })
}

export interface ImportCreateRequest { sourceId: string, rowId: string, confirmDuplicate?: boolean }

/** Tab-local metadata only. An uncertain response retries the identical key/body. No private cache. */
export function importDraftCommands(fetch: ApiFetch, accept: (review: AssistantImportReview) => void, active: (id: string) => boolean) {
  const pending = new Map<string, { key: string, body: CreateAssistantImportDraftInput }>()
  const assertActive = (id: string) => {
    if (!active(id)) throw new ApiError('The request was cancelled.', { kind: 'aborted', status: 0 })
  }
  return async (input: ImportCreateRequest): Promise<CreateAssistantImportDraftResult> => {
    assertActive(input.sourceId)
    const path = `${IMPORT_BASE}/${input.sourceId}`
    const review = await fetch<AssistantImportReview>(`${path}/review`)
    assertActive(input.sourceId)
    accept(review)
    const row = review.rows.find(r => r.id === input.rowId)
    if (row?.createdItemId) {
      pending.delete(`${input.sourceId}:${input.rowId}`)
      return { sourceId: input.sourceId, rowId: input.rowId, itemId: row.createdItemId, version: review.source.version, alreadyCreated: true, replayed: false }
    }
    const id = `${input.sourceId}:${input.rowId}`
    const action = pending.get(id) ?? { key: crypto.randomUUID(), body: { version: review.source.version, confirmDuplicate: input.confirmDuplicate === true } }
    pending.set(id, action)
    try {
      const result = await fetch<CreateAssistantImportDraftResult>(`${path}/review/${input.rowId}/create-draft`, { method: 'POST', headers: { 'Idempotency-Key': action.key }, body: action.body })
      assertActive(input.sourceId)
      pending.delete(id)
      // A replay's version is a snapshot. Always resume before the next row or editor action.
      const latest = await fetch<AssistantImportReview>(`${path}/review`)
      assertActive(input.sourceId)
      accept(latest)
      return result
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.status >= 400 && apiError.status < 500) pending.delete(id)
      throw apiError
    }
  }
}
