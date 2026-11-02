import type { ConsoleMessage, Page, Request } from 'playwright-core'

/**
 * What a page's browser reported that no test assertion looks at (D251): a console error, a
 * hydration message, an uncaught error, a request to our server that failed or answered 5xx.
 * `captureFailures` (failure-capture.ts) reads it for every page a test opened and fails a passing
 * test that has any, unless the test allowed it with `allowBrowserProblems`.
 *
 * Read after the test from Playwright's own history (`page.consoleMessages()`, `pageErrors()`,
 * `requests()`): the last 200 messages and errors and the last 100 requests of each page still open.
 * A page the test closed itself is not checked.
 */

/** Patterns the current test expects; cleared after every test. */
const allowed: RegExp[] = []

/**
 * Lets the current test's pages report problems that match: a test that answers 500 on purpose,
 * or cuts the network. Call it in the test, with a pattern as narrow as the problem it expects:
 * `allowBrowserProblems(/POST \/api\/c\/nuk\/admin\/categories → 500/)`.
 */
export function allowBrowserProblems(...patterns: RegExp[]) {
  allowed.push(...patterns)
}

/** The problems no `allowBrowserProblems` pattern of the current test matches. */
export function unexpectedProblems(problems: string[]) {
  return problems.filter(problem => !allowed.some(pattern => pattern.test(problem)))
}

/** Forgets the current test's allowed patterns (after each test). */
export function resetAllowedProblems() {
  allowed.length = 0
}

/** Every problem the page reported, one line each, in the order of its kind. */
export async function browserProblems(page: Page, origin: string): Promise<string[]> {
  const [messages, errors, requests] = await Promise.all([
    page.consoleMessages({ filter: 'all' }).catch(() => []),
    page.pageErrors({ filter: 'all' }).catch(() => []),
    page.requests().catch(() => []),
  ])
  const problems = new Set<string>()
  for (const message of messages) {
    const problem = consoleProblem(message)
    if (problem) problems.add(problem)
  }
  for (const error of errors) problems.add(`pageerror: ${error.message}`)
  for (const request of requests) {
    const problem = requestProblem(request, origin)
    if (problem) problems.add(problem)
  }
  return [...problems]
}

/**
 * A console error, or any message about hydration. Our production build logs only "Hydration
 * completed but contains mismatches." (an error); the e2e build adds Vue's detailed warning naming
 * the element (`debug.hydration` in nuxt.config.ts). Chrome's "Failed to load resource" errors are
 * left to `requestProblem`, which reports our server's 5xx and leaves expected 4xx answers alone.
 */
function consoleProblem(message: ConsoleMessage): string | undefined {
  const text = message.text()
  const hydration = /hydration/i.test(text)
  if (message.type() !== 'error' && !hydration) return undefined
  if (!hydration && text.startsWith('Failed to load resource:')) return undefined
  const { url, lineNumber } = message.location()
  return `console.${message.type()}: ${text}${url ? ` (${url}:${lineNumber})` : ''}`
}

/**
 * A request to our own origin that failed or answered 5xx. Aborted requests are normal (a newer
 * query or a navigation replaced them); other sites' requests are left out.
 */
function requestProblem(request: Request, origin: string): string | undefined {
  const address = new URL(request.url())
  if (address.origin !== origin) return undefined
  const name = `${request.method()} ${address.pathname}${address.search}`
  const failure = request.failure()
  if (failure) return failure.errorText === 'net::ERR_ABORTED' ? undefined : `request failed: ${name} (${failure.errorText})`
  const status = request.existingResponse()?.status()
  return status !== undefined && status >= 500 ? `${name} → ${status}` : undefined
}
