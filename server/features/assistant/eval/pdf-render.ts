import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

interface RenderOptions {
  executablePath?: string
  pages?: number[]
}

/** Local browser spike only. PDF.js and a browser are not added to the production Worker. */
export async function renderEvaluationPdf(bytes: Uint8Array<ArrayBuffer>, options: RenderOptions = {}) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Evaluation PDF must be between 1 byte and 5 MB.')
  const require = createRequire(import.meta.url)
  const [module, worker] = await Promise.all([
    readFile(require.resolve('pdfjs-dist/build/pdf.mjs')),
    readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs')),
  ])
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.url === '/pdf.mjs' || req.url === '/pdf.worker.mjs') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(req.url === '/pdf.mjs' ? module : worker)
    }
    else if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><title>Local PDF evaluation</title>')
    }
    else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch(options.executablePath ? { executablePath: options.executablePath } : { channel: 'chrome' })
    const page = await browser.newPage()
    page.setDefaultTimeout(30_000)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local evaluation server has no address.')
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.addScriptTag({ type: 'module', content: 'import * as pdfjs from "/pdf.mjs"; window.pdfjs = pdfjs;' })
    await page.waitForFunction(() => 'pdfjs' in globalThis)
    const started = performance.now()
    const result = await page.evaluate(async ({ base64, selected }) => {
      const browserGlobal = globalThis as unknown as {
        pdfjs: typeof import('pdfjs-dist')
        document: { createElement: (tag: 'canvas') => NonNullable<Parameters<import('pdfjs-dist').PDFPageProxy['render']>[0]['canvas']> }
      }
      const { pdfjs } = browserGlobal
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('/pdf.worker.mjs', location.href).href
      const loading = pdfjs.getDocument({ data: Uint8Array.from(atob(base64), c => c.charCodeAt(0)), stopAtErrors: true })
      try {
        const document = await loading.promise
        if (document.numPages > 5) throw new Error('Evaluation PDF exceeds the five-page cap.')
        const pages = selected ?? Array.from({ length: document.numPages }, (_, i) => i + 1)
        if (!pages.length || pages.length > 5 || new Set(pages).size !== pages.length || pages.some(n => !Number.isInteger(n) || n < 1 || n > document.numPages)) throw new Error('Invalid evaluation page selection.')
        const rendered = []
        for (const pageNumber of pages) {
          const pdfPage = await document.getPage(pageNumber)
          const original = pdfPage.getViewport({ scale: 1 })
          if (![original.width, original.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid PDF page dimensions.')
          const viewport = pdfPage.getViewport({ scale: Math.min(2, 1400 / Math.max(original.width, original.height)) })
          const canvas = browserGlobal.document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          if (canvas.width * canvas.height > 2_000_000) throw new Error('Evaluation page exceeds the pixel cap.')
          await pdfPage.render({ canvas, viewport }).promise
          const text = await pdfPage.getTextContent()
          const textCharacters = text.items.reduce((sum, item) => sum + ('str' in item ? item.str.trim().length : 0), 0)
          rendered.push({ page: pageNumber, width: canvas.width, height: canvas.height, textCharacters, png: canvas.toDataURL('image/png').split(',')[1]! })
          pdfPage.cleanup()
        }
        return { totalPages: document.numPages, pages: rendered }
      }
      finally { await loading.destroy() }
    }, { base64: Buffer.from(bytes).toString('base64'), selected: options.pages })
    return {
      totalPages: result.totalPages,
      latencyMs: Math.round(performance.now() - started),
      pages: result.pages.map(({ png, ...metadata }) => ({ ...metadata, bytes: new Uint8Array(Buffer.from(png, 'base64')) })),
    }
  }
  finally {
    await browser?.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}
