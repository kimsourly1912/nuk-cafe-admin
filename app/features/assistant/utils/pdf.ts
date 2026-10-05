import { ASSISTANT_IMPORT_MAX_BYTES, ASSISTANT_PDF_MAX_PAGES, ASSISTANT_PDF_PAGE_MAX_PIXELS, ASSISTANT_PDF_PAGE_MAX_SIDE } from '#shared/contracts/assistant-import'

/** Preparation limits, not server PDF validation or proof that a page has readable menu text. */
export const PDF_MAX_PAGES = ASSISTANT_PDF_MAX_PAGES
export const PDF_MAX_SIDE = ASSISTANT_PDF_PAGE_MAX_SIDE
export const PDF_MAX_PIXELS = ASSISTANT_PDF_PAGE_MAX_PIXELS
export const PDF_PREPARATION_TIMEOUT_MS = 30_000
export class PdfPreparationError extends Error {}

export function checkPdfBytes(size: number) {
  if (!Number.isInteger(size) || size < 1 || size > ASSISTANT_IMPORT_MAX_BYTES) throw new PdfPreparationError('Choose a PDF no larger than 5 MB.')
}
export function checkPdfPages(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > PDF_MAX_PAGES) throw new PdfPreparationError('Choose a PDF with one to five pages. Split a longer menu before uploading it.')
}
export function pdfSelection(value: unknown, count: number): number[] {
  checkPdfPages(count)
  if (value === undefined) return Array.from({ length: count }, (_, i) => i + 1)
  if (typeof value !== 'string' || !/^[1-5](?:,[1-5])*$/.test(value)) return []
  const pages = value.split(',').map(Number)
  return new Set(pages).size === pages.length && pages.every(n => n <= count) ? pages.sort((a, b) => a - b) : []
}
export function pdfViewport(width: number, height: number) {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new PdfPreparationError('This PDF page has invalid dimensions. Upload a readable copy or an image.')
  const scale = Math.min(2, PDF_MAX_SIDE / Math.max(width, height))
  const result = { scale, width: Math.ceil(width * scale), height: Math.ceil(height * scale) }
  if (result.width * result.height > PDF_MAX_PIXELS) throw new PdfPreparationError('This PDF page is too large to preview. Upload a smaller copy or an image.')
  return result
}
/** Never expose a parser message: it can contain private document data or internal URLs. */
export function pdfErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : ''
  if (name === 'PasswordException') return 'This PDF is password protected. Upload an unencrypted copy or a menu image.'
  return 'This PDF could not be previewed. Upload a readable, unencrypted copy or a menu image.'
}

/** Worker termination must settle the UI even if the parser's pending promise never rejects. */
export async function abortablePdf<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new DOMException('PDF preparation cancelled.', 'AbortError'))
    signal.addEventListener('abort', rejectAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  }
  finally { signal.removeEventListener('abort', rejectAbort) }
}
