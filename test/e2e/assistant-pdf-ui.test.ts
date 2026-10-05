import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPage, url } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { AssistantImportReview } from '../../shared/contracts/assistant-import'
import { mockApi, setupE2e } from './support/mock-api'

await setupE2e()
const fixture = (name: string) => readFileSync(new URL(`../../server/features/assistant/eval/fixtures/${name}`, import.meta.url))
const shots = fileURLToPath(new URL('../../docs/plans/assets/ai-assistant/d156/', import.meta.url))
const BASE = '/admin/assistant/imports'
const PAGE = '/c/nuk/admin/products/import'

async function open(name = 'mixed.pdf', options: { width?: number, pages?: string, expired?: boolean, held?: boolean, failure?: boolean } = {}) {
  const page = await createPage()
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 })
  await page.addInitScript(() => {
    const counts = { created: 0, terminated: 0 }
    const OriginalWorker = window.Worker
    window.Worker = class extends OriginalWorker {
      stopped = false
      constructor(script: string | URL, options?: WorkerOptions) {
        super(script, options)
        counts.created++
      }

      terminate() {
        if (!this.stopped) counts.terminated++
        this.stopped = true
        return super.terminate()
      }
    }
    Object.assign(window, { pdfWorkerCounts: counts })
  })
  const data = name === 'malformed.pdf' ? Buffer.from('%PDF-1.7\ninvalid private content') : fixture(name)
  const state: AssistantImportReview = { source: { id: crypto.randomUUID(), fileName: name, mimeType: 'application/pdf', byteSize: data.length, version: 1, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (options.expired ? -1000 : 86400000)).toISOString() }, state: 'none', rows: [], error: null, retryAt: null }
  const api = await mockApi(page, {
    'GET /admin/assistant/import-status': () => ({ enabled: true, pdfProcessing: false }),
    [`GET ${BASE}`]: () => [state.source],
    [`GET ${BASE}/{id}/review`]: () => structuredClone(state),
  })
  let sourceReads = 0
  let failure = options.failure
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/c/*/admin/assistant/imports/*/source', async (route) => {
    sourceReads++
    if (options.held) await held
    if (failure) {
      failure = false
      await route.fulfill({ status: 503, json: { statusCode: 503, data: { code: 'UNAVAILABLE', message: 'Could not read the private source.' } } })
    }
    else await route.fulfill({ status: 200, contentType: 'application/pdf', body: data })
  })
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto(url(`${PAGE}?source=${state.source.id}${options.pages !== undefined ? `&pages=${encodeURIComponent(options.pages)}` : ''}`), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Import menu', exact: true }).waitFor()
  return { page, state, api, requests, sourceReads: () => sourceReads, release }
}
async function render(page: Page, number = 1) {
  const preview = page.getByRole('img', { name: `PDF source page ${number}`, exact: true })
  await preview.waitFor()
  const measurements = await preview.evaluate((el) => {
    const canvas = el as HTMLCanvasElement
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let dark = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 200 && pixels[i + 3]! > 0) dark++
    return { width: canvas.width, height: canvas.height, dark }
  })
  expect(measurements.width).toBeLessThanOrEqual(1400)
  expect(measurements.height).toBeLessThanOrEqual(1400)
  expect(measurements.width * measurements.height).toBeLessThanOrEqual(2_000_000)
  expect(measurements.dark).toBeGreaterThan(100)
}
const workerCounts = (page: Page) => page.evaluate(() => (window as unknown as { pdfWorkerCounts: { created: number, terminated: number } }).pdfWorkerCounts)

describe('private PDF source preparation', () => {
  it('loads its private bytes and parser only after an explicit preview; renders mixed pages without inference', async () => {
    const { page, api, requests, sourceReads } = await open()
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).waitFor()
    expect(sourceReads()).toBe(0)
    expect(requests.some(u => u.includes('pdf.worker'))).toBe(false)
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await render(page)
    await page.getByRole('button', { name: 'View page 2', exact: true }).click()
    await render(page, 2)
    expect(sourceReads()).toBe(1)
    expect(await page.locator('canvas').count()).toBe(1)
    expect(api.calls.some(c => c.startsWith('POST '))).toBe(false)
    expect(await page.getByRole('button', { name: /Extract menu|Create.*draft/ }).count()).toBe(0)
  })
  it('keeps selected source page numbers through reload and refuses forged choices', async () => {
    const { page, state } = await open()
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await render(page)
    await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get('pages')).toBe('2')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await render(page, 2)
    expect(await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).isChecked()).toBe(false)
    await page.goto(url(`${PAGE}?source=${state.source.id}&pages=1,1,99`), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await page.getByText('0 of 2 pages selected', { exact: true }).waitFor()
    expect(await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).isChecked()).toBe(false)
  })
  it('renders text and scanned PDFs under the unchanged security policy without off-origin requests', async () => {
    for (const name of ['columns-and-sizes-text.pdf', 'columns-and-sizes-scan.pdf']) {
      const { page, requests } = await open(name)
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
      await render(page)
      expect(errors).toEqual([])
      const origin = new URL(page.url()).origin
      expect(requests.filter(u => !u.startsWith(origin))).toEqual([])
    }
  })
  it('refuses six-page, malformed and encrypted documents with safe actionable copy', async () => {
    for (const [name, message] of [
      ['six-pages.pdf', 'Choose a PDF with one to five pages. Split a longer menu before uploading it.'],
      ['malformed.pdf', 'This PDF could not be previewed. Upload a readable, unencrypted copy or a menu image.'],
      ['encrypted-menu.pdf', 'This PDF is password protected. Upload an unencrypted copy or a menu image.'],
    ]) {
      const { page } = await open(name)
      await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
      await page.getByText(message!, { exact: true }).waitFor()
      expect(await page.locator('canvas').count()).toBe(0)
      await expect.poll(() => workerCounts(page).then(c => c.created === c.terminated)).toBe(true)
    }
  })
  it('retries a private source read failure through the standard query', async () => {
    const { page, sourceReads } = await open('mixed.pdf', { failure: true })
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await page.getByText('Something went wrong on the server. Please try again.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await render(page)
    expect(sourceReads()).toBe(2)
  })
  it('releases its worker/canvas when the source expires or availability is revoked', async () => {
    for (const reason of ['expiry', 'disabled']) {
      const { page, state, api } = await open()
      await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
      await render(page)
      if (reason === 'expiry') {
        state.source.expiresAt = new Date(Date.now() - 1).toISOString()
        await page.getByRole('button', { name: 'Reload review', exact: true }).click()
        await page.getByText('This private import has expired', { exact: true }).waitFor()
      }
      else {
        api.set({ 'GET /admin/assistant/import-status': () => ({ enabled: false, pdfProcessing: false }) })
        await page.evaluate(() => {
          const channel = new BroadcastChannel('nuk-cafe-admin:data-changed')
          channel.postMessage({ features: ['assistant-import'] })
          channel.close()
        })
        await page.getByText('Menu import is not available yet', { exact: true }).waitFor()
      }
      expect(await page.locator('canvas').count()).toBe(0)
      await expect.poll(() => workerCounts(page).then(c => c.created === c.terminated)).toBe(true)
    }
  })
  it('cancels a delayed private read when leaving the source without accepting its late result', async () => {
    const { page, release, sourceReads } = await open('mixed.pdf', { held: true })
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await expect.poll(sourceReads).toBe(1)
    await page.getByRole('button', { name: 'Another source', exact: true }).click()
    await page.getByRole('heading', { name: 'Upload a menu', exact: true }).waitFor()
    release()
    expect(await page.locator('canvas').count()).toBe(0)
    expect((await workerCounts(page)).created).toBe(0)
  })
  it('removes the private preview and terminates its worker when signing out', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await render(page)
    await page.getByRole('button', { name: 'alice', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Log out' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/c/nuk/admin/login')
    expect(await page.locator('canvas').count()).toBe(0)
    await expect.poll(() => workerCounts(page).then(c => c.created === c.terminated)).toBe(true)
  })
  it('keeps page controls and a single preview usable at each width, dark mode and 200 percent text', async () => {
    const { page } = await open()
    mkdirSync(shots, { recursive: true })
    await page.getByRole('button', { name: 'Preview PDF pages', exact: true }).click()
    await render(page)
    for (const [width, height] of [[320, 900], [390, 900], [768, 900], [1024, 900], [1440, 900], [1920, 1080], [844, 390]]) {
      await page.setViewportSize({ width: width!, height: height! })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `${shots}/pdf-pages-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: `${shots}/pdf-pages-dark-390.png`, fullPage: true })
    await page.evaluate(() => document.documentElement.style.fontSize = '200%')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('checkbox', { name: 'Select page 1', exact: true }).focus()
    await page.keyboard.press('Space')
    await expect.poll(() => new URL(page.url()).searchParams.get('pages')).toBe('2')
  }, 120_000)
})
