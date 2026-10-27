import { alertTenantOf, toErrorResponse } from '#server/utils/errors'
import { log } from '#server/utils/log'

/**
 * Error responses for `/api/**` (docs/server/architecture.md → Errors). Registered first in
 * `nuxt.config.ts` (`nitro:config` hook); anything else falls through to Nuxt's own handler, which
 * renders the error pages.
 * - The body is h3's shape with our `data.code` and the request id.
 * - 5xx never carry details to the client; the cause is logged with the request id, and chats that
 *   want server errors on Telegram get an alert naming the route and the request id (step 10.4,
 *   D119): only the chats of the cafe the request resolved (D138). An error outside a cafe (the
 *   platform's routes, sign-in) stays in the logs: a cafe never hears about the platform (D220).
 *   The alert is queued in the background and can't fail the response.
 */
/**
 * Imported when needed, so the notifications feature (and grammY) stays out of the handler's chunk
 * and a failure while alerting is only logged.
 */
async function alertServerError(info: { method: string, path: string, status: number, requestId: string | null }, tenantId: string, event: Parameters<typeof log>[3]) {
  try {
    const { queueServerErrorAlert } = await import('#server/features/notifications')
    await queueServerErrorAlert(useDb(), tenantId, info)
  }
  catch (failure) {
    log('warn', 'Could not queue the server error alert', { error: failure instanceof Error ? failure.message : String(failure) }, event)
  }
}

export default defineNitroErrorHandler(async (error, event) => {
  if (!event.path.startsWith('/api/')) return

  const requestId = event.context.requestId as string | undefined
  const { status, body, isServerError } = toErrorResponse(error, requestId)
  if (isServerError) {
    log('error', 'Unhandled error', { status, error: error.message, cause: String(error.cause ?? ''), stack: error.stack }, event)
    const tenantId = alertTenantOf(event.context)
    if (tenantId) event.waitUntil(alertServerError({ method: event.method, path: event.path, status, requestId: requestId ?? null }, tenantId, event))
  }

  setResponseStatus(event, status)
  setResponseHeader(event, 'Content-Type', 'application/json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  await send(event, JSON.stringify(body))
})
