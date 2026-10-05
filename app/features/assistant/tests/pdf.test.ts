import { describe, expect, it } from 'vitest'
import { ASSISTANT_IMPORT_MAX_BYTES } from '#shared/contracts/assistant-import'
import { abortablePdf, checkPdfBytes, checkPdfPages, PDF_MAX_PIXELS, PDF_MAX_SIDE, PdfPreparationError, pdfErrorMessage, pdfSelection, pdfViewport } from '../utils/pdf'

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
