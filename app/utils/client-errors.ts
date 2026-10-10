import type { ClientErrorReport } from '#shared/contracts/client-errors'
import { CLIENT_ERROR_MESSAGE_MAX, CLIENT_ERROR_PAGE_MAX, CLIENT_ERROR_STACK_MAX } from '#shared/contracts/client-errors'
import { ApiError } from './api-error'

/** At most this many reports per page load: a broken loop mustn't flood the logs. */
export const CLIENT_ERROR_REPORT_LIMIT = 10

export interface ClientErrorReporterOptions {
  /** Sends one report (`POST /api/client-errors`); never throws. */
  send: (report: ClientErrorReport) => void
  /** The page's address now (`location.pathname`). */
  page: () => string
  build?: string
}

/**
 * Whether an error is worth a report (D149). Our API's failures (`ApiError`) are already logged by
 * the server; a cancelled request (`AbortError`) is on purpose.
 */
export function isReportable(error: unknown): boolean {
  if (error instanceof ApiError) return false
  if (error instanceof Error && error.name === 'AbortError') return false
  return error !== undefined && error !== null
}

/** The path without its query or hash: a reset link's token lives in the query. */
export const pageOf = (path: string) => path.split(/[?#]/)[0]!.slice(0, CLIENT_ERROR_PAGE_MAX)

/**
 * Turns uncaught browser errors into reports (D149): each message once per page load, and at most
 * `CLIENT_ERROR_REPORT_LIMIT` in all. Framework-free, so it is unit-tested; `plugins/errors.ts`
 * wires it to Vue and the window.
 */
export function createClientErrorReporter(options: ClientErrorReporterOptions) {
  const seen = new Set<string>()
  let sent = 0

  function report(kind: ClientErrorReport['kind'], error: unknown) {
    if (!isReportable(error) || sent >= CLIENT_ERROR_REPORT_LIMIT) return
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, CLIENT_ERROR_MESSAGE_MAX)
    if (seen.has(message)) return
    seen.add(message)
    sent++
    const stack = error instanceof Error && error.stack ? error.stack.slice(0, CLIENT_ERROR_STACK_MAX) : undefined
    options.send({ kind, message, stack, page: pageOf(options.page()), build: options.build })
  }

  return { report }
}
