import type { LanguageModel, LanguageModelUsage } from 'ai'
import { NoObjectGeneratedError } from 'ai'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import type { Db } from '#server/utils/batch'
import { requireOneChange, runBatch } from '#server/utils/batch'
import { versionConflict } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import { parseInput } from '#server/utils/validation'
import type { AssistantImportReview, FinishAssistantPdfInput, PrepareAssistantPdfInput } from '#shared/contracts/assistant-import'
import { ASSISTANT_IMPORT_MAX_ITEMS, ASSISTANT_PDF_MAX_PAGE_ATTEMPTS, assistantPdfPageNumberSchema, finishAssistantPdfSchema, prepareAssistantPdfSchema } from '#shared/contracts/assistant-import'
import type { AssistantSettings } from './assistant.settings'
import type { ImportObjectStore } from './assistant-import.service'
import { readImportSource } from './assistant-import.service'
import { aiLimitReached } from './assistant.errors'
import { importAlreadyReviewed, importBusy, importCancelled, importNotFound, importPdfEmpty, importPdfNotConfigured, importPdfNotPrepared, importPdfPageLimit, importPdfPageNotSelected, importPdfRequired, importPdfSelectionFixed, importResultInvalid } from './assistant-import.errors'
import { assertReviewSize, extractMenuImage, IMPORT_INFERENCE_TIMEOUT_MS, IMPORT_LEASE_MS, toReviewRows } from './assistant-extraction'
import { extractionFailure, getImportReview } from './assistant-review.service'
import { finishUsage, startUsage, usageResult } from './assistant.service'
import type { AssistantPdfData } from './assistant-pdf'
import { checkPdfPageImage } from './assistant-pdf'
import * as sourceRepo from './assistant-import.repository'
import * as leaseRepo from './assistant-review.repository'
import * as repo from './assistant-pdf.repository'

async function pdfSource(db: Db, actor: Actor, id: string) {
  const row = await sourceRepo.findSource(db, actor, id, new Date())
  if (!row) throw importNotFound()
  if (row.mimeType !== 'application/pdf') throw importPdfRequired()
  return row
}

/** Fix supplied source-page labels once, without changing expiry or calling a model. */
export async function prepareImportPdf(db: Db, actor: Actor, id: string, command: PrepareAssistantPdfInput): Promise<AssistantImportReview> {
  const input = parseInput(prepareAssistantPdfSchema, command)
  const row = await pdfSource(db, actor, id)
  if (row.version !== input.version) throw versionConflict('This import')
  const pageNumbers = [...input.pageNumbers].sort((a, b) => a - b)
  if (row.pdfReview) {
    if (row.pdfReview.pages.map(p => p.pageNumber).join(',') !== pageNumbers.join(',')) throw importPdfSelectionFixed()
    return getImportReview(db, actor, id)
  }
  if (row.reviewState !== 'none') throw importAlreadyReviewed()
  const pdf: AssistantPdfData = { pages: pageNumbers.map(pageNumber => ({ pageNumber, state: 'pending', attempts: 0, itemCount: 0, error: null })) }
  await runBatch(db, [repo.prepareStatement(db, actor, id, input.version, pdf, new Date()), requireOneChange(db),
    auditStatement(db, actor, { action: 'assistant.import.pdf.prepared', targetType: 'assistant_import', targetId: id, metadata: { pageNumbers } })], () => versionConflict('This import'))
  return getImportReview(db, actor, id)
}

/** One bounded supplied PNG, one lease, one metered call; prior page evidence is preserved. */
export async function extractImportPdfPage(db: Db, store: ImportObjectStore, actor: Actor, id: string, pageNumber: number, version: number, bytes: Uint8Array<ArrayBuffer>, context: () => { settings: AssistantSettings, model: LanguageModel }, signal?: AbortSignal): Promise<AssistantImportReview> {
  signal?.throwIfAborted()
  parseInput(assistantPdfPageNumberSchema, pageNumber)
  const row = await pdfSource(db, actor, id)
  const page = row.pdfReview?.pages.find(p => p.pageNumber === pageNumber)
  if (!page) throw importPdfPageNotSelected()
  // Response loss/retry must never overwrite completed evidence or spend another slot.
  if (page.state === 'ready') return getImportReview(db, actor, id)
  if (row.reviewState === 'ready') throw importAlreadyReviewed()
  if (row.version !== version) throw versionConflict('This import')
  if (await leaseRepo.activeLease(db, actor, new Date())) throw importBusy()
  if (page.attempts >= ASSISTANT_PDF_MAX_PAGE_ATTEMPTS) throw importPdfPageLimit()
  checkPdfPageImage(bytes)
  // Original still exists privately; supplied rasters are not attested against its contents.
  await readImportSource(db, store, actor, id)
  const { settings, model } = context()
  if (settings.provider !== 'cloudflare') throw importPdfNotConfigured()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const imageDigest = [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
  signal?.throwIfAborted()
  const extractionId = newId()
  const deadline = new Date(Date.now() + IMPORT_LEASE_MS)
  const pdf = structuredClone(row.pdfReview!)
  const currentPage = pdf.pages.find(p => p.pageNumber === pageNumber)!
  Object.assign(currentPage, { state: 'processing', attempts: page.attempts + 1, error: null, imageDigest })
  await runBatch(db, [
    leaseRepo.claimLeaseStatement(db, actor, extractionId, deadline, new Date()), requireOneChange(db),
    repo.beginStatement(db, actor, id, version, pdf, extractionId, deadline, new Date()), requireOneChange(db),
    auditStatement(db, actor, { action: 'assistant.import.pdf.extract.requested', targetType: 'assistant_import', targetId: id, metadata: { pageNumber } }),
  ], importBusy)
  let usageId: string | undefined
  let tokens: LanguageModelUsage | undefined
  let called = false
  let outcome: 'ok' | 'error' = 'error'
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(IMPORT_INFERENCE_TIMEOUT_MS)]) : AbortSignal.timeout(IMPORT_INFERENCE_TIMEOUT_MS)
  try {
    usageId = await startUsage(db, actor, settings, 'menu_import', new Date(), { sourceId: id, pageNumber })
    currentPage.usageId = usageId
    abort.throwIfAborted()
    const active = await sourceRepo.findSource(db, actor, id, new Date())
    if (!active || active.extractionId !== extractionId || active.version !== version + 1) throw importCancelled()
    called = true
    const result = await extractMenuImage(model, bytes, 'image/png', abort)
    tokens = result.usage
    abort.throwIfAborted()
    if (result.finishReason !== 'stop') throw importResultInvalid()
    const added = toReviewRows(result.output).map(r => ({ ...r, sourcePageNumber: pageNumber }))
    const rows = [...row.reviewRows ?? [], ...added].sort((a, b) => a.sourcePageNumber! - b.sourcePageNumber!)
    if (rows.length > ASSISTANT_IMPORT_MAX_ITEMS) throw importResultInvalid()
    Object.assign(currentPage, { state: 'ready', itemCount: added.length, error: null })
    assertReviewSize(rows, pdf)
    await runBatch(db, [repo.finishStatement(db, actor, id, version + 1, extractionId, pdf, rows, new Date()), requireOneChange(db),
      auditStatement(db, actor, { action: 'assistant.import.pdf.extract.completed', targetType: 'assistant_import', targetId: id, metadata: { pageNumber, itemCount: added.length } })], importCancelled)
    outcome = 'ok'
    return await getImportReview(db, actor, id)
  }
  catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) tokens = error.usage
    const dailyLimit = !usageId && error && typeof error === 'object' && 'data' in error
      && error.data && typeof error.data === 'object' && 'code' in error.data && error.data.code === 'AI_LIMIT_REACHED'
    const mapped = dailyLimit ? { code: 'AI_LIMIT_REACHED' as const, error: aiLimitReached(settings.dailyLimit) } : extractionFailure(error, abort)
    Object.assign(currentPage, { state: 'failed', attempts: called ? page.attempts + 1 : page.attempts, itemCount: 0, error: mapped.code })
    await repo.failPage(db, actor, id, version + 1, extractionId, pdf, mapped.code).catch(() => {})
    throw mapped.error
  }
  finally {
    try {
      if (usageId) await finishUsage(db, usageId, usageResult(outcome, tokens))
    }
    finally { await leaseRepo.releaseLease(db, actor, extractionId).catch(() => {}) }
  }
}

/** Explicitly accept existing successes and skip unresolved pages; never re-extract a review. */
export async function finishImportPdf(db: Db, actor: Actor, id: string, command: FinishAssistantPdfInput): Promise<AssistantImportReview> {
  const input = parseInput(finishAssistantPdfSchema, command)
  const row = await pdfSource(db, actor, id)
  if (!row.pdfReview) throw importPdfNotPrepared()
  if (row.reviewState === 'ready') return getImportReview(db, actor, id)
  if (row.version !== input.version) throw versionConflict('This import')
  if (row.reviewState === 'processing' && row.extractionDeadline && row.extractionDeadline > new Date()) throw importBusy()
  if (!row.reviewRows?.length || !row.pdfReview.pages.some(p => p.state === 'ready')) throw importPdfEmpty()
  const pdf: AssistantPdfData = { pages: row.pdfReview.pages.map(p => p.state === 'ready' ? p : { ...p, state: 'skipped' }) }
  assertReviewSize(row.reviewRows, pdf)
  await runBatch(db, [repo.finalizeStatement(db, actor, id, input.version, pdf, new Date()), requireOneChange(db),
    auditStatement(db, actor, { action: 'assistant.import.pdf.partial.accepted', targetType: 'assistant_import', targetId: id, metadata: { skippedPages: pdf.pages.filter(p => p.state === 'skipped').map(p => p.pageNumber) } })], () => versionConflict('This import'))
  return getImportReview(db, actor, id)
}
