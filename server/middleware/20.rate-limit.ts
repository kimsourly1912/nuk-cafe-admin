import { enforceRateLimit, rateLimitRule } from '#server/utils/rate-limit'

/** Per-address limits on the public API and placing orders (D121, D140, D156): see server/utils/rate-limit.ts. */
export default defineEventHandler(async (event) => {
  if (!rateLimitRule(event.path, event.method)) return
  await enforceRateLimit(event)
})
