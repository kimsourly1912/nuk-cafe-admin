import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { getBrowser } from '@nuxt/test-utils/e2e'
import { afterEach, beforeEach } from 'vitest'

/**
 * What the browser showed when an e2e test failed: for each page the test opened, a screenshot,
 * its address and its HTML, under `test-results/e2e/<file> - <test>/`. CI uploads that folder only
 * when a job fails (`.github/workflows/ci.yml`), so an intermittent failure leaves evidence instead
 * of only "timed out". `setupE2e` registers it after test-utils' hooks and the hook that closes
 * extra tabs, so its `afterEach` runs first, while everything the test opened is still there.
 */
export const FAILURE_DIR = join(process.cwd(), 'test-results', 'e2e')

const pagesOf = (browser: Browser): Page[] => browser.contexts().flatMap(context => context.pages())

/** A folder name from the test's file and name, safe on every OS. */
export const failureFolder = (file: string, test: string) =>
  `${file.split(/[\\/]/).pop()} - ${test}`.replace(/[^\w .-]+/g, '_').slice(0, 120)

export function captureFailures() {
  // Kept from `beforeEach`: test-utils' own `afterEach` clears its context before this one runs.
  let browser: Browser | undefined
  let before = new Set<Page>()
  beforeEach(async () => {
    browser = await getBrowser()
    before = new Set(pagesOf(browser))
  })
  afterEach(async (context) => {
    if (context.task.result?.state !== 'fail' || !browser) return
    const opened = pagesOf(browser).filter(page => !before.has(page) && !page.isClosed())
    if (!opened.length) return
    const folder = join(FAILURE_DIR, failureFolder(context.task.file?.name ?? 'e2e', context.task.name))
    await mkdir(folder, { recursive: true })
    await Promise.all(opened.map(async (page, i) => {
      const name = `page-${i + 1}`
      await page.screenshot({ path: join(folder, `${name}.png`), fullPage: true, timeout: 5000 }).catch(() => {})
      const html = await page.content().catch(() => '')
      await writeFile(join(folder, `${name}.html`), html)
      await writeFile(join(folder, `${name}.txt`), `${page.url()}\n${await page.title().catch(() => '')}\n`)
    }))
  })
}
