import { toErrorResponse } from '#server/utils/errors'
import { log } from '#server/utils/log'

/**
 * Error responses for `/api/**` (docs/server/architecture.md → Errors). Registered first in
 * `nuxt.config.ts` (`nitro:config` hook); anything else falls through to Nuxt's own handler, which
 * renders the error pages.
 * - The body is h3's shape with our `data.code` and the request id.
 * - 5xx never carry details to the client; the cause is logged with the request id, and chats that
 *   want server errors on Telegram get an alert naming the route and the request id (step 10.4,
 *   D119): the chats of the request's tenant (D138; the only tenant while the request hadn't
 *   resolved one, until addresses name it, T1.5). The alert is queued in the background and can't
 *   fail the response.
 */
/**
 * Imported when needed, so the notifications feature (and grammY) stays out of the handler's chunk
 * and a failure while alerting is only logged.
 */
async function alertServerError(info: { method: string, path: string, status: number, requestId: string | null }, requestTenantId: string | undefined, event: Parameters<typeof log>[3]) {
  try {
    const [{ queueServerErrorAlert }, { currentTenant }] = await Promise.all([import('#server/features/notifications'), import('#server/features/identity')])
    const db = useDb()
    const tenantId = requestTenantId ?? (await currentTenant(db).catch(() => null))?.id
    if (tenantId) await queueServerErrorAlert(db, tenantId, info)
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
    event.waitUntil(alertServerError({ method: event.method, path: event.path, status, requestId: requestId ?? null }, (event.context.tenant as { id: string } | undefined)?.id, event))
  }

  setResponseStatus(event, status)
  setResponseHeader(event, 'Content-Type', 'application/json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  await send(event, JSON.stringify(body))
})
