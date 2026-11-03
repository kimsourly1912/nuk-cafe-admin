import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { getBrowser } from '@nuxt/test-utils/e2e'
import { afterEach, beforeEach, expect, inject } from 'vitest'
import { browserProblems, resetAllowedProblems, unexpectedProblems } from './browser-problems'
import { redactFailureEntry } from './failure-redaction'

/**
 * What the browser showed when an e2e test failed: for each page the test opened, a screenshot,
 * its address, its HTML and what the browser reported (console errors, hydration messages, page
 * errors, failed requests: browser-problems.ts), under `test-results/e2e/<file> - <test>/`. CI
 * uploads that folder only when a job fails (`.github/workflows/ci.yml`), so an intermittent failure
 * leaves evidence instead of only "timed out" (D249).
 *
 * A test that passed but whose pages reported a problem it didn't allow (`allowBrowserProblems`)
 * fails here, with the same evidence (D251).
 *
 * `setupE2e` registers it after test-utils' hooks and the hook that closes extra tabs, so its
 * `afterEach` runs first, while everything the test opened is still there.
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
    if (!browser) return resetAllowedProblems()
    const opened = pagesOf(browser).filter(page => !before.has(page) && !page.isClosed())
    const origin = new URL(inject('e2eHost')).origin
    const reported = await Promise.all(opened.map(page => browserProblems(page, origin)))
    const unexpected = reported.flatMap(problems => unexpectedProblems(problems))
    resetAllowedProblems()

    if (opened.length && (context.task.result?.state === 'fail' || unexpected.length)) {
      const folder = join(FAILURE_DIR, failureFolder(context.task.file?.name ?? 'e2e', context.task.name))
      await mkdir(folder, { recursive: true })
      await Promise.all(opened.map(async (page, i) => {
        const name = `page-${i + 1}`
        const secrets = 'input[type="password"], input[autocomplete="new-password"], input[autocomplete="current-password"], input[autocomplete="one-time-code"], [data-testid="backup-codes"], [data-testid="two-factor-key"], [aria-label="QR code for your authenticator app"]'
        await page.screenshot({ path: join(folder, `${name}.png`), fullPage: true, timeout: 5000, mask: [page.locator(secrets)] }).catch(() => {})
        const html = await page.evaluate((selector) => {
          const copy = document.documentElement.cloneNode(true) as HTMLElement
          for (const element of copy.querySelectorAll(selector)) element.replaceWith(document.createTextNode('[redacted]'))
          return copy.outerHTML
        }, secrets).catch(() => '')
        const redacted = redactFailureEntry(page.url(), html)
        await writeFile(join(folder, `${name}.html`), redacted.html)
        await writeFile(join(folder, `${name}.txt`), `${redacted.address}\n${await page.title().catch(() => '')}\n`)
        // Every problem, allowed ones too: an allowed 500 can still explain a failure.
        if (reported[i]!.length) await writeFile(join(folder, `${name}.problems.txt`), `${reported[i]!.join('\n')}\n`)
      }))
    }

    expect(unexpected, 'The browser reported problems; fix them, or allow an expected one in the test with allowBrowserProblems(/…/)').toEqual([])
  })
}
