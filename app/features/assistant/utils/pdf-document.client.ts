import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { abortablePdf, checkPdfBytes, checkPdfPages, pdfViewport } from './pdf'

/** One owned module worker; no PDF viewer, links, annotations, scripting or remote document URL. */
export async function openImportPdf(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  checkPdfBytes(bytes.byteLength)
  signal.throwIfAborted()
  const pdfjs = await import('pdfjs-dist')
  signal.throwIfAborted()
  // A same-origin worker is required. Never fall back to parsing an upload on the UI thread.
  const worker = new Worker(workerUrl, { type: 'module' })
  const pdfWorker = pdfjs.PDFWorker.create({ port: worker })
  let loading: PDFDocumentLoadingTask | undefined
  let document: PDFDocumentProxy | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    signal.removeEventListener('abort', dispose)
    // Request library cleanup, then terminate our owned worker even if parsing has stalled.
    void loading?.destroy().catch(() => {})
    pdfWorker.destroy()
    worker.terminate()
    document = undefined
  }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    loading = pdfjs.getDocument({ data: bytes, worker: pdfWorker, stopAtErrors: true,
      useWasm: false, useWorkerFetch: false, disableFontFace: true, useSystemFonts: true,
      canvasMaxAreaInBytes: PDF_MAX_CANVAS_BYTES, verbosity: 0 })
    document = await abortablePdf(loading.promise, signal)
    signal.throwIfAborted()
    checkPdfPages(document.numPages)
    const totalPages = document.numPages
    return {
      totalPages,
      dispose,
      async render(pageNumber: number, canvas: HTMLCanvasElement) {
        signal.throwIfAborted()
        if (disposed || !document || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) throw new Error('Invalid PDF page.')
        const page = await abortablePdf(document.getPage(pageNumber), signal)
        try {
          const original = page.getViewport({ scale: 1 })
          const bounded = pdfViewport(original.width, original.height)
          canvas.width = bounded.width
          canvas.height = bounded.height
          const task = page.render({ canvas, viewport: page.getViewport({ scale: bounded.scale }) })
          const cancel = () => task.cancel()
          signal.addEventListener('abort', cancel, { once: true })
          try {
            await abortablePdf(task.promise, signal)
            signal.throwIfAborted()
          }
          finally { signal.removeEventListener('abort', cancel) }
        }
        finally { page.cleanup() }
      },
    }
  }
  catch (error) {
    dispose()
    throw error
  }
}

const PDF_MAX_CANVAS_BYTES = 8_000_000
