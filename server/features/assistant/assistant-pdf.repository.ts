import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { Actor } from '#server/features/identity'
import type { Db, Statement } from '#server/utils/batch'
import type { AssistantImportFailure, AssistantImportReviewRow } from '#shared/contracts/assistant-import'
import type { AssistantPdfData } from './assistant-pdf'
import { assistantImports } from './assistant.schema'

const visible = (actor: Actor, id: string, now: Date) => and(
  eq(assistantImports.tenantId, actor.tenantId), eq(assistantImports.userId, actor.userId),
  eq(assistantImports.id, id), eq(assistantImports.state, 'uploaded'),
  eq(assistantImports.mimeType, 'application/pdf'), gt(assistantImports.expiresAt, now),
)

export function prepareStatement(db: Db, actor: Actor, id: string, version: number, pdf: AssistantPdfData, now: Date): Statement {
  return db.update(assistantImports).set({ pdfReview: pdf, reviewRows: [], version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.version, version), isNull(assistantImports.pdfReview), eq(assistantImports.reviewState, 'none')))
}
export function beginStatement(db: Db, actor: Actor, id: string, version: number, pdf: AssistantPdfData, extractionId: string, deadline: Date, now: Date): Statement {
  return db.update(assistantImports).set({ pdfReview: pdf, reviewState: 'processing', extractionId, extractionDeadline: deadline, extractionError: null, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.version, version), isNotNull(assistantImports.pdfReview), sql`${assistantImports.reviewState} != 'ready'`))
}
export function finishStatement(db: Db, actor: Actor, id: string, version: number, extractionId: string, pdf: AssistantPdfData, rows: AssistantImportReviewRow[], now: Date): Statement {
  return db.update(assistantImports).set({ pdfReview: pdf, reviewRows: rows, reviewState: pdf.pages.every(p => p.state === 'ready') ? 'ready' : 'none', extractionId: null, extractionDeadline: null, extractionError: null, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.version, version), eq(assistantImports.reviewState, 'processing'), eq(assistantImports.extractionId, extractionId), gt(assistantImports.extractionDeadline, now)))
}
/** Failed/cancelled pages cannot erase another page's successful evidence. */
export async function failPage(db: Db, actor: Actor, id: string, version: number, extractionId: string, pdf: AssistantPdfData, error: AssistantImportFailure) {
  await db.update(assistantImports).set({ pdfReview: pdf, reviewState: 'failed', extractionId: null, extractionDeadline: null, extractionError: error, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, new Date()), eq(assistantImports.version, version), eq(assistantImports.reviewState, 'processing'), eq(assistantImports.extractionId, extractionId)))
}
export function finalizeStatement(db: Db, actor: Actor, id: string, version: number, pdf: AssistantPdfData, now: Date): Statement {
  return db.update(assistantImports).set({ pdfReview: pdf, reviewState: 'ready', extractionId: null, extractionDeadline: null, extractionError: null, version: sql`${assistantImports.version} + 1` })
    .where(and(visible(actor, id, now), eq(assistantImports.version, version), isNotNull(assistantImports.pdfReview), sql`${assistantImports.reviewState} != 'ready'`,
      or(sql`${assistantImports.reviewState} != 'processing'`, lte(assistantImports.extractionDeadline, now))))
}
