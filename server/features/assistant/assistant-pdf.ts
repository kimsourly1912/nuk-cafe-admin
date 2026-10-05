import type { AssistantImportFailure, AssistantPdfReview } from '#shared/contracts/assistant-import'
import { ASSISTANT_PDF_PAGE_MAX_BYTES, ASSISTANT_PDF_PAGE_MAX_PIXELS, ASSISTANT_PDF_PAGE_MAX_SIDE } from '#shared/contracts/assistant-import'
import { importPdfPageInvalid } from './assistant-import.errors'
import { checkExtractionImage } from './assistant-extraction'

/** Private linkage; usage/audits never contain rasters or extracted text. */
export interface AssistantPdfData extends AssistantPdfReview {
  pages: (AssistantPdfReview['pages'][number] & { usageId?: string, imageDigest?: string })[]
}

export function pdfReviewFor(data: AssistantPdfData, processing: boolean, error: AssistantImportFailure | null): AssistantPdfReview {
  return { pages: data.pages.map(page => ({
    pageNumber: page.pageNumber, attempts: page.attempts, itemCount: page.itemCount,
    state: page.state === 'processing' && !processing ? 'failed' : page.state,
    error: page.state === 'processing' && !processing ? error ?? 'AI_IMPORT_INTERRUPTED' : page.error,
  })) }
}

/** Supplied image admission only; neither a full PNG decode nor proof of PDF provenance. */
export function checkPdfPageImage(bytes: Uint8Array<ArrayBuffer>) {
  if (!bytes.length || bytes.length > ASSISTANT_PDF_PAGE_MAX_BYTES) throw importPdfPageInvalid()
  try {
    const { width, height } = checkExtractionImage(bytes, 'image/png')
    if (width > ASSISTANT_PDF_PAGE_MAX_SIDE || height > ASSISTANT_PDF_PAGE_MAX_SIDE || width * height > ASSISTANT_PDF_PAGE_MAX_PIXELS) throw importPdfPageInvalid()
  }
  catch { throw importPdfPageInvalid() }
}
