import { isError } from 'h3'
import type { Actor } from '#server/features/identity'
import type { PreparedItemCreation } from '#server/features/menu'
import { prepareItemCreation } from '#server/features/menu'
import { auditStatement, withIdempotency } from '#server/features/platform'
import type { Db } from '#server/utils/batch'
import { reviewByteSize } from './assistant-extraction'
import { isStaleWrite, requireOneChange } from '#server/utils/batch'
import { apiError, versionConflict } from '#server/utils/errors'
import { parseInput } from '#server/utils/validation'
import type { CreateAssistantImportDraftInput, CreateAssistantImportDraftResult } from '#shared/contracts/assistant-import'
import { ASSISTANT_IMPORT_REVIEW_MAX_BYTES, createAssistantImportDraftSchema } from '#shared/contracts/assistant-import'
import { createItemSchema } from '#shared/contracts/menu-items'
import { importNotFound } from './assistant-import.errors'
import * as sourceRepo from './assistant-import.repository'
import * as reviewRepo from './assistant-review.repository'

/** Leave D1 Free headroom for access, planning, replay and failed-guard diagnostics. */
export const IMPORT_DRAFT_MAX_STATEMENTS = 20

const unavailable = () => apiError(503, 'AI_IMPORT_DRAFT_UNAVAILABLE', 'The draft could not be saved. Your review is still available. Try again.')

/** Only safe application errors escape; driver parameters may contain the private review. */
async function draftFailure(db: Db, actor: Actor, id: string, version: number, prepared: PreparedItemCreation | undefined, error: unknown): Promise<Error> {
  try {
    if (isStaleWrite(error)) {
      const current = await sourceRepo.findSource(db, actor, id, new Date())
      if (!current) throw importNotFound()
      if (current.version !== version) throw versionConflict('This import')
    }
    if (prepared) await prepared.handleError(error)
    throw error
  }
  catch (mapped) {
    if (isError(mapped) && mapped.statusCode >= 400 && mapped.statusCode < 500
      && mapped.data && typeof mapped.data === 'object' && 'code' in mapped.data && typeof mapped.data.code === 'string') return mapped
    return unavailable()
  }
}

/** Explicit, one-row draft creation. The receipt, menu writes and replay response commit together. */
export async function createImportDraft(db: Db, actor: Actor, id: string, rowId: string, input: CreateAssistantImportDraftInput, key: string): Promise<CreateAssistantImportDraftResult> {
  const command = parseInput(createAssistantImportDraftSchema, input)
  // Check access/expiry even on a replay; the platform helper must never resurrect a private source.
  const source = await sourceRepo.findSource(db, actor, id, new Date())
  if (!source) throw importNotFound()
  if (source.reviewState !== 'ready') throw apiError(409, 'INVALID_STATE', 'Wait for a review before creating drafts.')
  const row = source.reviewRows?.find(r => r.id === rowId)
  if (!row) throw importNotFound()
  let prepared: PreparedItemCreation | undefined
  const scope = { tenantId: actor.tenantId, actorId: actor.userId, operation: 'assistant.import.create-draft', key }
  const request = { sourceId: id, rowId, ...command }
  try {
    const result = await withIdempotency(db, scope, request, async () => {
      if (row.createdItemId) {
        return { statements: [], response: { sourceId: id, rowId, itemId: row.createdItemId, version: source.version, alreadyCreated: true } }
      }
      if (source.version !== command.version) throw versionConflict('This import')
      if (!row.selected) throw apiError(409, 'AI_IMPORT_ROW_EXCLUDED', 'Select this row before creating its draft.')
      // Validate the saved correction, not evidence or a fresh client-supplied menu command.
      const item = parseInput(createItemSchema, { ...row.draft, imageId: null })
      prepared = await prepareItemCreation(db, actor, item, { rejectDuplicateName: !command.confirmDuplicate })
      if (prepared.statements.length > IMPORT_DRAFT_MAX_STATEMENTS) throw apiError(422, 'AI_IMPORT_DRAFT_TOO_COMPLEX', 'Reduce this item’s variations or add-on price overrides before importing it, or create it through Menu items.')
      const rows = source.reviewRows!.map(r => r.id === rowId ? { ...r, createdItemId: prepared!.id } : r)
      if (reviewByteSize(rows, source.pdfReview) > ASSISTANT_IMPORT_REVIEW_MAX_BYTES) throw apiError(413, 'PAYLOAD_TOO_LARGE', 'This review is too large to save a draft receipt. Reduce the corrections first.')
      return { statements: [
        reviewRepo.updateRowsStatement(db, actor, id, command.version, rows, new Date()), requireOneChange(db),
        ...prepared.statements,
        auditStatement(db, actor, { action: 'assistant.import.draft.created', targetType: 'assistant_import', targetId: id, metadata: { rowId, itemId: prepared.id } }),
      ], response: { sourceId: id, rowId, itemId: prepared.id, version: command.version + 1, alreadyCreated: false } }
    })
    if (!await sourceRepo.findSource(db, actor, id, new Date())) throw importNotFound()
    return { ...result.response, replayed: result.replayed }
  }
  catch (error) {
    try {
      // A competing identical call may commit while this call is still planning, before its batch.
      // Replay its metadata-only result even when local planning then fails on a changed library/name.
      if (!await sourceRepo.findSource(db, actor, id, new Date())) throw importNotFound()
      const replay = await withIdempotency<Omit<CreateAssistantImportDraftResult, 'replayed'>>(db, scope, request, async () => {
        throw error
      })
      if (!await sourceRepo.findSource(db, actor, id, new Date())) throw importNotFound()
      return { ...replay.response, replayed: replay.replayed }
    }
    catch (mapped) { throw await draftFailure(db, actor, id, command.version, prepared, mapped) }
  }
}
