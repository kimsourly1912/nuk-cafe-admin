import { toErrorResponse } from './utils/errors'
import { log } from './utils/log'

/**
 * Error responses for `/api/**` (docs/server/architecture.md → Errors). Registered first in
 * `nuxt.config.ts` (`nitro:config` hook); anything else falls through to Nuxt's own handler, which
 * renders the error pages.
 * - The body is h3's shape with our `data.code` and the request id.
 * - 5xx never carry details to the client; the cause is logged with the request id.
 */
export default defineNitroErrorHandler(async (error, event) => {
  if (!event.path.startsWith('/api/')) return

  const requestId = event.context.requestId as string | undefined
  const { status, body, isServerError } = toErrorResponse(error, requestId)
  if (isServerError) {
    log('error', 'Unhandled error', { status, error: error.message, cause: String(error.cause ?? ''), stack: error.stack }, event)
  }

  setResponseStatus(event, status)
  setResponseHeader(event, 'Content-Type', 'application/json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  await send(event, JSON.stringify(body))
})
