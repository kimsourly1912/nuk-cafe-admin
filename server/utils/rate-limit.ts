import type { H3Event } from 'h3'
import { apiError, ErrorCodes } from '#server/utils/errors'
import { log } from '#server/utils/log'

/**
 * Rate limits for the public API (`/api/public/**`, D121), counted per client address with
 * Cloudflare's Workers rate-limit bindings. The first rule whose prefix matches applies. Limits are
 * generous on purpose: customers in the cafe share its Wi-Fi, so one address can be many people.
 * A rule's numbers live in the Worker's configuration (nuxt.config.ts → `ratelimits`).
 *
 * Where no binding exists (the dev server, tests, the e2e build), nothing is limited. Cloudflare
 * counts per location and lets a few requests past a limit: this bounds abuse, it isn't a quota.
 */
export const RATE_LIMIT_RULES = [
  // Prices the whole order from the catalog: the costliest public call.
  { prefix: '/api/public/checkout/quote', binding: 'RATE_LIMIT_QUOTE' },
  { prefix: '/api/public/', binding: 'RATE_LIMIT_PUBLIC' },
] as const

export type RateLimitBinding = (typeof RATE_LIMIT_RULES)[number]['binding']

/** Cloudflare's binding (`env.X.limit({ key })`); a stand-in in tests. */
export interface RateLimiter {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

export interface RateLimitRequest {
  path: string
  /** `cf-connecting-ip`: set by Cloudflare, a client can't forge it. */
  address: string | undefined
  limiters: Partial<Record<RateLimitBinding, RateLimiter>>
}

/** `limited` names the binding that refused; `checked` false when no rule, binding or address applied. */
export async function checkRateLimit(request: RateLimitRequest): Promise<{ checked: boolean, limited: RateLimitBinding | null }> {
  const rule = RATE_LIMIT_RULES.find(candidate => request.path.startsWith(candidate.prefix))
  const limiter = rule ? request.limiters[rule.binding] : undefined
  if (!rule || !limiter || !request.address) return { checked: false, limited: null }
  const { success } = await limiter.limit({ key: request.address })
  return { checked: true, limited: success ? null : rule.binding }
}

export const rateLimited = () =>
  apiError(429, ErrorCodes.RATE_LIMITED, 'Too many requests from your connection. Wait a minute and try again.')

/** The middleware's work: refuses with 429 when over the limit; a broken limiter lets the request through. */
export async function enforceRateLimit(event: H3Event) {
  const env = (event.context.cloudflare as { env?: Partial<Record<RateLimitBinding, RateLimiter>> } | undefined)?.env
  if (!env) return
  let outcome: Awaited<ReturnType<typeof checkRateLimit>>
  try {
    outcome = await checkRateLimit({ path: event.path, address: getHeader(event, 'cf-connecting-ip'), limiters: env })
  }
  catch (error) {
    log('warn', 'Rate limiter unavailable; request allowed', { error: String(error) }, event)
    return
  }
  if (outcome.limited) {
    log('info', 'Rate limited', { binding: outcome.limited }, event)
    setResponseHeader(event, 'Retry-After', 60)
    throw rateLimited()
  }
}
