import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { MENU_CASES } from './menu-cases'
import { renderEvaluationPdf } from './pdf-render'

const options = { executablePath: process.env.ASSISTANT_EVAL_CHROMIUM }
const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)))

describe('local browser PDF spike (no inference)', () => {
  it.each(MENU_CASES)('$id: text PDFs have text; scanned PDFs render without a text layer', { timeout: 60_000 }, async (c) => {
    const text = await renderEvaluationPdf(await fixture(`${c.id}-text.pdf`), options)
    const scan = await renderEvaluationPdf(await fixture(`${c.id}-scan.pdf`), options)
    expect(text.totalPages).toBe(1)
    expect(scan.totalPages).toBe(1)
    expect(text.pages[0]!.textCharacters).toBeGreaterThan(20)
    expect(scan.pages[0]!.textCharacters).toBe(0)
    expect(scan.pages[0]!.bytes.length).toBeGreaterThan(1000)
    expect(scan.pages[0]!.width).toBeLessThanOrEqual(1400)
    expect(scan.pages[0]!.height).toBeLessThanOrEqual(1400)
    console.log(JSON.stringify({ fixture: c.id, textRenderMs: text.latencyMs, scanRenderMs: scan.latencyMs, scanBytes: scan.pages[0]!.bytes.length, width: scan.pages[0]!.width, height: scan.pages[0]!.height }))
  })

  it('refuses a document over five pages before rendering', { timeout: 60_000 }, async () => {
    await expect(renderEvaluationPdf(await fixture('six-pages.pdf'), options)).rejects.toThrow('five-page cap')
  })
  it('renders a mixed two-page document and preserves explicit page selection', { timeout: 60_000 }, async () => {
    const bytes = await fixture('mixed.pdf')
    const result = await renderEvaluationPdf(bytes, options)
    expect(result.totalPages).toBe(2)
    expect(result.pages.map(p => p.page)).toEqual([1, 2])
    expect(result.pages[0]!.textCharacters).toBeGreaterThan(20)
    expect(result.pages[1]!.textCharacters).toBe(0)
    const selected = await renderEvaluationPdf(bytes, { ...options, pages: [2] })
    expect(selected.totalPages).toBe(2)
    expect(selected.pages.map(p => p.page)).toEqual([2])
    console.log(JSON.stringify({ fixture: 'mixed', renderMs: result.latencyMs, pages: result.pages.map(({ bytes, ...p }) => ({ ...p, pngBytes: bytes.length })) }))
  })
  it('refuses nonexistent and duplicated page selections', { timeout: 60_000 }, async () => {
    const bytes = await fixture('columns-and-sizes-text.pdf')
    await expect(renderEvaluationPdf(bytes, { ...options, pages: [2] })).rejects.toThrow('Invalid evaluation page selection')
    await expect(renderEvaluationPdf(bytes, { ...options, pages: [1, 1] })).rejects.toThrow('Invalid evaluation page selection')
  })
  it('refuses malformed PDFs', { timeout: 60_000 }, async () => {
    await expect(renderEvaluationPdf(new TextEncoder().encode('not a PDF'), options)).rejects.toThrow()
  })
})
