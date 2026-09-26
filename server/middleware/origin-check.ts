/**
 * CSRF protection for cookie-authenticated writes to our API (Better Auth checks its own routes).
 * A write to `/api/v1` must come from this site: its `Origin` (or, failing that, `Referer`) must be
 * the request's own origin or the configured site URL. SameSite=Lax cookies alone would still
 * accept a write from a sibling subdomain.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler((event) => {
  if (SAFE_METHODS.has(event.method) || !event.path.startsWith('/api/v1/')) return

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
