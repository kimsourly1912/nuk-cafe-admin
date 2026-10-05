import type { LanguageModel, LanguageModelUsage } from 'ai'
import { NoObjectGeneratedError } from 'ai'
import * as v from 'valibot'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import type { Db } from '#server/utils/batch'
import { requireOneChange, runBatch } from '#server/utils/batch'
import { apiError, versionConflict } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import type { AssistantImportFailure, AssistantImportReview, UpdateAssistantImportRowInput } from '#shared/contracts/assistant-import'
import { ASSISTANT_IMPORT_REVIEW_MAX_BYTES, updateAssistantImportRowSchema } from '#shared/contracts/assistant-import'
import type { AssistantSettings } from './assistant.settings'
import { aiLimitReached } from './assistant.errors'
import { assistantSettingsFrom } from './assistant.settings'
import { finishUsage, startUsage, usageResult } from './assistant.service'
import { importAlreadyReviewed, importBusy, importCancelled, importCapacityReached, importExtractionFailed, importNotFound, importPdfPending, importResultInvalid, importReviewUnavailable } from './assistant-import.errors'
import type { ImportObjectStore } from './assistant-import.service'
import { readImportSource, toImportSource } from './assistant-import.service'
import { checkExtractionImage, extractMenuImage, IMPORT_INFERENCE_TIMEOUT_MS, IMPORT_LEASE_MS, toReviewRows } from './assistant-extraction'
import * as sourceRepo from './assistant-import.repository'
import * as repo from './assistant-review.repository'

/** Independent of the help provider/key; no default vision model is implied. */
export function importSettingsFrom(raw: { importModel?: string, dailyLimit?: number | string }): AssistantSettings {
  return assistantSettingsFrom({ enabled: true, provider: 'cloudflare', model: raw.importModel, dailyLimit: raw.dailyLimit })!
}

export async function getImportReview(db: Db, actor: Actor, id: string): Promise<AssistantImportReview> {
  const now = new Date()
  const row = await sourceRepo.findSource(db, actor, id, now)
  if (!row) throw importNotFound()
  const interrupted = row.reviewState === 'processing' && (!row.extractionDeadline || row.extractionDeadline <= now)
  const lease = row.reviewState === 'processing' || row.extractionError === 'AI_IMPORT_CANCELLED' ? await repo.activeLease(db, actor, now) : undefined
  return { source: toImportSource(row), state: interrupted ? 'failed' : row.reviewState,
    error: interrupted ? 'AI_IMPORT_INTERRUPTED' : row.extractionError,
    retryAt: lease?.deadline.toISOString() ?? null, rows: row.reviewState === 'ready' ? row.reviewRows ?? [] : [] }
}

function failure(error: unknown, signal: AbortSignal): { code: AssistantImportFailure, error: Error } {
  if (signal.aborted) return { code: 'AI_IMPORT_CANCELLED', error: importCancelled() }
  if (NoObjectGeneratedError.isInstance(error)) return { code: 'AI_IMPORT_RESULT_INVALID', error: importResultInvalid() }
  const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
  const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined
  if (status === 429) return { code: 'AI_CAPACITY_REACHED', error: importCapacityReached() }
  if (data && typeof data === 'object' && 'code' in data && data.code === 'AI_IMPORT_CANCELLED') return { code: 'AI_IMPORT_CANCELLED', error: importCancelled() }
  if (data && typeof data === 'object' && 'code' in data && data.code === 'AI_IMPORT_RESULT_INVALID') return { code: 'AI_IMPORT_RESULT_INVALID', error: importResultInvalid() }
  return { code: 'AI_IMPORT_EXTRACTION_FAILED', error: importExtractionFailed() }
}

/** One metered image call, then a private review. No tools or menu writes. */
export async function extractImportSource(db: Db, store: ImportObjectStore, actor: Actor, id: string, version: number, context: () => { settings: AssistantSettings, model: LanguageModel }, signal?: AbortSignal): Promise<AssistantImportReview> {
  signal?.throwIfAborted()
  const now = new Date()
  const row = await sourceRepo.findSource(db, actor, id, now)
  if (!row) throw importNotFound()
  if (row.version !== version) throw versionConflict('This import')
  if (row.reviewState === 'ready') throw importAlreadyReviewed()
  if (row.mimeType === 'application/pdf') throw importPdfPending()
  if (await repo.activeLease(db, actor, now)) throw importBusy()
  const { data } = await readImportSource(db, store, actor, id)
  const bytes = new Uint8Array(await data.arrayBuffer())
  checkExtractionImage(bytes, row.mimeType)
  const { settings, model } = context()
  if (settings.provider !== 'cloudflare') throw apiError(500, 'AI_IMPORT_NOT_CONFIGURED', 'Menu extraction requires the Cloudflare AI binding.')
  signal?.throwIfAborted()
  const extractionId = newId()
  const deadline = new Date(Date.now() + IMPORT_LEASE_MS)
  await runBatch(db, [
    repo.claimLeaseStatement(db, actor, extractionId, deadline, new Date()), requireOneChange(db),
    repo.beginStatement(db, actor, id, version, extractionId, deadline, new Date()), requireOneChange(db),
    auditStatement(db, actor, { action: 'assistant.import.extract.requested', targetType: 'assistant_import', targetId: id }),
  ], importBusy)
  let usageId: string | undefined
  let tokens: LanguageModelUsage | undefined
  let outcome: 'ok' | 'error' = 'error'
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(IMPORT_INFERENCE_TIMEOUT_MS)]) : AbortSignal.timeout(IMPORT_INFERENCE_TIMEOUT_MS)
  try {
    usageId = await startUsage(db, actor, settings, 'menu_import')
    abort.throwIfAborted()
    // Recheck after the reservation: discard/expiry must prevent an inference that hasn't begun.
    const current = await sourceRepo.findSource(db, actor, id, new Date())
    if (!current || current.extractionId !== extractionId) throw importCancelled()
    const result = await extractMenuImage(model, bytes, row.mimeType, abort)
    tokens = result.usage
    abort.throwIfAborted()
    if (result.finishReason !== 'stop') throw importResultInvalid()
    const rows = toReviewRows(result.output)
    await runBatch(db, [
      repo.finishStatement(db, actor, id, extractionId, rows, new Date()), requireOneChange(db),
      auditStatement(db, actor, { action: 'assistant.import.extract.completed', targetType: 'assistant_import', targetId: id, metadata: { itemCount: rows.length } }),
    ], importCancelled)
    outcome = 'ok'
    return await getImportReview(db, actor, id)
  }
  catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) tokens = error.usage
    const dailyLimit = !usageId && error && typeof error === 'object' && 'data' in error
      && error.data && typeof error.data === 'object' && 'code' in error.data && error.data.code === 'AI_LIMIT_REACHED'
    const mapped = dailyLimit ? { code: 'AI_LIMIT_REACHED' as const, error: aiLimitReached(settings.dailyLimit) } : failure(error, abort)
    // Storage/SQL/provider errors can contain document text. Persist/return safe codes only.
    await repo.failExtraction(db, actor, id, extractionId, mapped.code).catch(() => {})
    throw mapped.error
  }
  finally {
    try {
      if (usageId) await finishUsage(db, usageId, usageResult(outcome, tokens))
    }
    finally { await repo.releaseLease(db, actor, extractionId).catch(() => {}) }
  }
}

/** One row at a time: the shared source version prevents cross-tab lost edits/discard races. */
export async function updateImportReviewRow(db: Db, actor: Actor, id: string, rowId: string, input: UpdateAssistantImportRowInput): Promise<AssistantImportReview> {
  const parsed = v.safeParse(updateAssistantImportRowSchema, input)
  if (!parsed.success) throw apiError(400, 'VALIDATION_FAILED', 'The review correction is invalid.')
  const row = await sourceRepo.findSource(db, actor, id, new Date())
  if (!row) throw importNotFound()
  if (row.version !== input.version) throw versionConflict('This import')
  if (row.reviewState !== 'ready') throw apiError(409, 'INVALID_STATE', 'Wait for a review before editing it.')
  if (!row.reviewRows?.some(r => r.id === rowId)) throw importNotFound()
  const rows = row.reviewRows.map(r => r.id === rowId ? { ...r, selected: input.selected ?? r.selected, draft: parsed.output.draft ?? r.draft } : r)
  if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > ASSISTANT_IMPORT_REVIEW_MAX_BYTES) throw apiError(413, 'PAYLOAD_TOO_LARGE', 'This review is too large. Reduce the number of variations in the correction.')
  try {
    await runBatch(db, [repo.updateRowsStatement(db, actor, id, input.version, rows, new Date()), requireOneChange(db),
      auditStatement(db, actor, { action: 'assistant.import.review.updated', targetType: 'assistant_import', targetId: id, metadata: { rowId } })], () => versionConflict('This import'))
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409) throw error
    throw importReviewUnavailable()
  }
  return getImportReview(db, actor, id)
}

/** Revokes the attempt's right to save. The lease stays until its worker exits or 90 s passes. */
export async function cancelImportExtraction(db: Db, actor: Actor, id: string, version: number): Promise<AssistantImportReview> {
  const row = await sourceRepo.findSource(db, actor, id, new Date())
  if (!row) throw importNotFound()
  if (row.version !== version) throw versionConflict('This import')
  if (row.reviewState !== 'processing') throw apiError(409, 'INVALID_STATE', 'This import is not processing.')
  await runBatch(db, [repo.cancelStatement(db, actor, id, version, new Date()), requireOneChange(db),
    auditStatement(db, actor, { action: 'assistant.import.extract.cancelled', targetType: 'assistant_import', targetId: id })], () => versionConflict('This import'))
  return getImportReview(db, actor, id)
}
