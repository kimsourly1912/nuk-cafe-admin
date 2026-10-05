import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import type { MenuCase } from './menu-cases'

/** Generates synthetic evaluation assets only, never part of the product upload flow. */
export async function generateMenuFixtures(cases: MenuCase[], html: (body: string) => string, executablePath?: string) {
  const directory = fileURLToPath(new URL('./fixtures/', import.meta.url))
  await mkdir(directory, { recursive: true })
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 1 })
    for (const c of cases) {
      await page.setContent(html(c.html))
      const png = await page.screenshot({ fullPage: true })
      await writeFile(`${directory}${c.id}.png`, png)
      await page.pdf({ path: `${directory}${c.id}-text.pdf`, printBackground: true, preferCSSPageSize: true })
      await page.setContent(html(`<img style="width:100%;display:block" src="data:image/png;base64,${png.toString('base64')}">`))
      await page.pdf({ path: `${directory}${c.id}-scan.pdf`, printBackground: true, preferCSSPageSize: true })
    }
    const scan = await readFile(`${directory}${cases[1]!.id}.png`)
    await page.setContent(html(`<style>body{padding:0}.sheet{height:900px;padding:36px;break-after:page;overflow:hidden}</style><div class="sheet">${cases[0]!.html}</div><div class="sheet"><img style="width:100%" src="data:image/png;base64,${scan.toString('base64')}"></div>`))
    await page.pdf({ path: `${directory}mixed.pdf`, printBackground: true, preferCSSPageSize: true })
    await page.setContent(html(Array.from({ length: 6 }, (_, i) => `<div style="break-after:page">Page ${i + 1}</div>`).join('')))
    await page.pdf({ path: `${directory}six-pages.pdf`, printBackground: true, preferCSSPageSize: true })
  }
  finally { await browser.close() }
}
