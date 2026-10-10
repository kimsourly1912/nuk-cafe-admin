import { clientErrorSchema } from '#shared/contracts/client-errors'

/**
 * `POST /api/client-errors` (D149): a browser error nobody caught, one structured line in Workers
 * Logs ("Browser error", searchable by page and build). Nothing is stored or sent on: the text comes
 * from the browser, so it never reaches Telegram or a screen. Same-origin only (the origin check)
 * and rate limited per address like the public API; the app sends at most 10 per page load.
 */
export default defineEventHandler(async (event) => {
  const report = await readValidBody(event, clientErrorSchema)
  log('error', 'Browser error', {
    kind: report.kind,
    error: report.message,
    stack: report.stack,
    page: report.page,
    build: report.build,
    userAgent: getHeader(event, 'user-agent')?.slice(0, 300),
  }, event)
  setResponseStatus(event, 204)
  return null
})
