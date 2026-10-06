import { describe, expect, it, vi } from 'vitest'
import type { AssistantImportReview } from '#shared/contracts/assistant-import'
import { ASSISTANT_IMPORT_MAX_BYTES, ASSISTANT_PDF_PAGE_MAX_BYTES } from '#shared/contracts/assistant-import'
import { abortablePdf, checkPdfBytes, checkPdfPageBlob, checkPdfPages, PDF_MAX_PIXELS, PDF_MAX_SIDE, PdfPreparationError, pdfErrorMessage, pdfCanvasBlob, pdfSelection, pdfUnfinishedPages, pdfViewport } from '../utils/pdf'

describe('private PDF preparation bounds', () => {
  it('refuses empty/oversized sources and more than five pages before preparation', () => {
    for (const size of [0, -1, 1.5, ASSISTANT_IMPORT_MAX_BYTES + 1]) expect(() => checkPdfBytes(size)).toThrow(PdfPreparationError)
    checkPdfBytes(ASSISTANT_IMPORT_MAX_BYTES)
    for (const count of [0, 1.5, 6, Infinity]) expect(() => checkPdfPages(count)).toThrow(PdfPreparationError)
    checkPdfPages(5)
  })
  it('preserves explicit page identity and refuses malformed/duplicate/out-of-range URL choices', () => {
    expect(pdfSelection(undefined, 3)).toEqual([1, 2, 3])
    expect(pdfSelection('3,1', 3)).toEqual([1, 3])
    for (const value of ['', '1,1', '4', '0', '-1', '1.5', '01', '1,2,', ['1'], '1,private text']) expect(pdfSelection(value, 3)).toEqual([])
  })
  it('bounds landscape, portrait and enormous PDF dimensions without distorting aspect ratio', () => {
    for (const [width, height] of [[595, 842], [842, 595], [100_000, 100_000], [3, 900_000]]) {
      const view = pdfViewport(width!, height!)
      expect(view.width).toBeLessThanOrEqual(PDF_MAX_SIDE)
      expect(view.height).toBeLessThanOrEqual(PDF_MAX_SIDE)
      expect(view.width * view.height).toBeLessThanOrEqual(PDF_MAX_PIXELS)
      expect(view.width).toBe(Math.ceil(width! * view.scale))
    }
    for (const width of [0, -1, Infinity, NaN]) expect(() => pdfViewport(width, 10)).toThrow(PdfPreparationError)
  })
  it('returns actionable password copy and never emits private parser details', () => {
    expect(pdfErrorMessage({ name: 'PasswordException', message: 'Private cafe document' })).toContain('password protected')
    expect(pdfErrorMessage(new Error('Private cafe document'))).not.toContain('Private cafe')
  })
  it('settles cancellation while a terminated parser promise remains pending', async () => {
    const controller = new AbortController()
    const pending = abortablePdf(new Promise(() => {}), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect(abortablePdf(Promise.resolve(1), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await abortablePdf(Promise.resolve(3), new AbortController().signal)).toBe(3)
  })
})

describe('request-local supplied PDF pages', () => {
  it('retries only unfinished eligible labels, preserving successful/skipped/capped pages', () => {
    const review = { state: 'failed', pdf: { pages: [
      { pageNumber: 1, state: 'ready', attempts: 1 }, { pageNumber: 2, state: 'failed', attempts: 2 },
      { pageNumber: 3, state: 'pending', attempts: 0 }, { pageNumber: 4, state: 'skipped', attempts: 0 },
      { pageNumber: 5, state: 'failed', attempts: 3 },
    ] } } as AssistantImportReview
    expect(pdfUnfinishedPages(review)).toEqual([2, 3])
    expect(pdfUnfinishedPages({ ...review, state: 'ready' })).toEqual([])
    expect(pdfUnfinishedPages({ state: 'none' } as AssistantImportReview)).toEqual([])
    expect(pdfUnfinishedPages({ state: 'processing', pdf: { pages: [{ pageNumber: 2, state: 'processing', attempts: 1 }] } } as AssistantImportReview)).toEqual([])
  })
  it('requires a nonempty PNG Blob within the transport budget', () => {
    const valid = new Blob(['png'], { type: 'image/png' })
    expect(() => checkPdfPageBlob(valid)).not.toThrow()
    expect(() => checkPdfPageBlob(new Blob([new Uint8Array(ASSISTANT_PDF_PAGE_MAX_BYTES)], { type: 'image/png' }))).not.toThrow()
    for (const blob of [null, new Blob([], { type: 'image/png' }), new Blob(['x'], { type: 'image/jpeg' }), new Blob([new Uint8Array(ASSISTANT_PDF_PAGE_MAX_BYTES + 1)], { type: 'image/png' })]) expect(() => checkPdfPageBlob(blob)).toThrow(PdfPreparationError)
  })
  it('encodes bounded canvases as PNG and refuses a null encoding result', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    const toBlob = vi.fn((resolve: BlobCallback) => resolve(blob))
    const canvas = { width: 1400, height: 900, toBlob } as unknown as HTMLCanvasElement
    const signal = new AbortController().signal
    expect(await pdfCanvasBlob(canvas, signal)).toBe(blob)
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    toBlob.mockImplementationOnce(resolve => resolve(null))
    await expect(pdfCanvasBlob(canvas, signal)).rejects.toThrow(PdfPreparationError)
  })
  it.each([[0, 100], [1401, 100], [100, 1401]])('refuses invalid output dimensions before encoding (%s × %s)', async (width, height) => {
    const toBlob = vi.fn((resolve: BlobCallback) => resolve(new Blob(['png'], { type: 'image/png' })))
    await expect(pdfCanvasBlob({ width, height, toBlob } as unknown as HTMLCanvasElement, new AbortController().signal)).rejects.toThrow(PdfPreparationError)
    expect(toBlob).not.toHaveBeenCalled()
  })
  it('settles cancellation during stalled encoding and never revives a late callback', async () => {
    const controller = new AbortController()
    let callback!: BlobCallback
    const toBlob = vi.fn((resolve: BlobCallback) => {
      callback = resolve
    })
    const canvas = { width: 100, height: 100, toBlob } as unknown as HTMLCanvasElement
    const result = pdfCanvasBlob(canvas, controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    callback(new Blob(['late'], { type: 'image/png' }))
    await expect(pdfCanvasBlob(canvas, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(toBlob).toHaveBeenCalledOnce()
  })
})
