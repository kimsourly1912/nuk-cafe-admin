import type { H3Event } from 'h3'
import { apiError, ErrorCodes } from '#server/utils/errors'
import { log } from '#server/utils/log'

/**
 * Rate limits for the public API and placing orders (a cafe's `/api/c/<slug>/public/**`, the global table scan
 * `/api/tables/**`, a cafe's profile `/api/cafes/**` browser error reports `/api/client-errors` and the leaked-password ranges `/api/password-ranges/**`, D121, D140, D143, D149, D210), counted per client address with
 * Cloudflare's Workers rate-limit bindings. The first rule whose prefix matches applies. Limits are
 * generous on purpose: customers in the cafe share its Wi-Fi, so one address can be many people.
 * A rule's numbers live in the Worker's configuration (nuxt.config.ts → `ratelimits`).
 *
 * Where no binding exists (the dev server, tests, the e2e build), nothing is limited. Cloudflare
 * counts per location and lets a few requests past a limit: this bounds abuse, it isn't a quota.
 */
export const RATE_LIMIT_RULES = [
  // Deleting an account (D237): each try checks a password, so few a minute.
  { prefix: '/api/me/delete-account', exact: true, method: 'POST', binding: 'RATE_LIMIT_ACCOUNT' },
  // Placing an order, now that a guest can (D156): only the POST, never the order page's polling.
  { prefix: '/api/shop/orders', exact: true, method: 'POST', binding: 'RATE_LIMIT_ORDERS' },
  // Prices the whole order from the catalog: the costliest public call.
  { prefix: '/api/public/checkout/quote', binding: 'RATE_LIMIT_QUOTE' },
  { prefix: '/api/public/', binding: 'RATE_LIMIT_PUBLIC' },
  { prefix: '/api/tables/', binding: 'RATE_LIMIT_PUBLIC' },
  // A cafe's name and logo (D143): public like the menu.
  { prefix: '/api/cafes/', binding: 'RATE_LIMIT_PUBLIC' },
  // Browser error reports (D149): anyone can send them, so they share the public limit.
  { prefix: '/api/client-errors', binding: 'RATE_LIMIT_PUBLIC' },
  // The new-password checklist's leaked-password ranges (D210): public, and each one calls Have I Been Pwned.
  { prefix: '/api/password-ranges/', binding: 'RATE_LIMIT_PUBLIC' },
] as const satisfies readonly { prefix: string, exact?: boolean, method?: string, binding: string }[]

/** The rule for a request: the first whose prefix (and method, when it names one) matches. */
export function rateLimitRule(path: string, method: string) {
  const named = rateLimitPath(path)
  return RATE_LIMIT_RULES.find(rule => ('exact' in rule && rule.exact ? named === rule.prefix : named.startsWith(rule.prefix)) && (!('method' in rule) || rule.method === method))
}

/**
 * A path as the rules name it: a cafe's prefix dropped (`/api/c/nuk/public/menu` → `/api/public/menu`),
 * so every cafe shares one set of rules and each address's count covers them all.
 */
export function rateLimitPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '').replace(/^\/api\/c\/[^/]+(?=\/)/, '/api')
}

export type RateLimitBinding = (typeof RATE_LIMIT_RULES)[number]['binding']

/** Cloudflare's binding (`env.X.limit({ key })`); a stand-in in tests. */
export interface RateLimiter {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

export interface RateLimitRequest {
  path: string
  method?: string
  /** `cf-connecting-ip`: set by Cloudflare, a client can't forge it. */
  address: string | undefined
  limiters: Partial<Record<RateLimitBinding, RateLimiter>>
}

/** `limited` names the binding that refused; `checked` false when no rule, binding or address applied. */
export async function checkRateLimit(request: RateLimitRequest): Promise<{ checked: boolean, limited: RateLimitBinding | null }> {
  const rule = rateLimitRule(request.path, request.method ?? 'GET')
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
    outcome = await checkRateLimit({ path: event.path, method: event.method, address: getHeader(event, 'cf-connecting-ip'), limiters: env })
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
