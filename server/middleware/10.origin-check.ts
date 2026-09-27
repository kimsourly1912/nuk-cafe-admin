/**
 * CSRF protection for cookie-authenticated writes to our API (docs/server/security.md → Request
 * protection). A write to `/api/**` must come from this site: its `Origin` (or, failing that,
 * `Referer`) must be the request's own origin or the configured site URL, the same origins Better
 * Auth trusts. SameSite=Lax cookies alone would still accept a write from a sibling subdomain.
 * Better Auth checks its own routes; webhooks authenticate by signature.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const EXEMPT_PREFIXES = ['/api/auth/', '/api/webhooks/']

export default defineEventHandler((event) => {
  const path = event.path
  if (SAFE_METHODS.has(event.method) || !path.startsWith('/api/') || EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix))) return

  const origin = getHeader(event, 'origin') ?? originOf(getHeader(event, 'referer'))
  const siteUrl = useRuntimeConfig(event).public.siteUrl as string | undefined
  const allowed = [getRequestURL(event).origin, originOf(siteUrl)]
  if (!origin || !allowed.includes(origin)) {
    throw apiError(403, 'FORBIDDEN', 'This request must come from the NUK Cafe site.')
  }
})

function originOf(url: string | undefined) {
  if (!url) return undefined
  try {
    return new URL(url).origin
  }
  catch {
    return undefined
  }
}
