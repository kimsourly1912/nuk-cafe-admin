import { enforceRateLimit, RATE_LIMIT_RULES, rateLimitPath } from '#server/utils/rate-limit'

/** Per-address limits on the public API (D121, D140): see server/utils/rate-limit.ts. */
export default defineEventHandler(async (event) => {
  const path = rateLimitPath(event.path)
  if (!RATE_LIMIT_RULES.some(rule => path.startsWith(rule.prefix))) return
  await enforceRateLimit(event)
})
