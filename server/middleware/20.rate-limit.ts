import { enforceRateLimit } from '#server/utils/rate-limit'

/** Per-address limits on the public API (D121): see server/utils/rate-limit.ts. */
export default defineEventHandler(async (event) => {
  if (!event.path.startsWith('/api/public/')) return
  await enforceRateLimit(event)
})
