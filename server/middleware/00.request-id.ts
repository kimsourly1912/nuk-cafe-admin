import { newId } from '../utils/ids'

/**
 * Gives every request an id (Cloudflare's `cf-ray` when present, else a new one), available as
 * `event.context.requestId`, sent back as `X-Request-Id`, and included in error bodies and logs so
 * a user's screenshot of an error leads to the log line. Runs first (file name order).
 */
export default defineEventHandler((event) => {
  const requestId = getHeader(event, 'cf-ray') || newId()
  event.context.requestId = requestId
  setHeader(event, 'X-Request-Id', requestId)
})
