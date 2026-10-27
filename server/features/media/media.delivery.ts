import { IMAGE_MAX_BYTES } from '#shared/contracts/media'
import { log } from '#server/utils/log'
import { isPublicMediaKey } from './media.rules'

export const PUBLIC_IMAGE_BROWSER_CACHE = 'public, max-age=31536000, immutable'
const EDGE_TTL_SECONDS = 3600
const CACHE_NAME = 'public-menu-images-v1'
type ImageCache = Pick<Cache, 'match' | 'put'>

/** Only immutable public image bytes; never API responses, sources or arbitrary URL variants. */
function cacheableRequest(request: Request): boolean {
  const url = new URL(request.url)
  return request.method === 'GET' && url.protocol === 'https:' && !url.search
    && url.pathname.startsWith('/media/') && isPublicMediaKey(url.pathname.slice(7))
    && !['authorization', 'range', 'if-range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']
      .some(header => request.headers.has(header))
}

function cacheableResponse(response: Response): boolean {
  const size = Number(response.headers.get('content-length'))
  return response.status === 200 && response.body !== null
    && response.headers.get('cache-control') === PUBLIC_IMAGE_BROWSER_CACHE
    && /^(?:image\/jpeg|image\/png|image\/webp)$/.test(response.headers.get('content-type') ?? '')
    && Number.isSafeInteger(size) && size > 0 && size <= IMAGE_MAX_BYTES
    && !['set-cookie', 'vary', 'content-range'].some(header => response.headers.has(header))
}

const withCacheStatus = (response: Response, status: 'HIT' | 'MISS' | 'BYPASS') => {
  const result = new Response(response.body, response)
  result.headers.set('X-Media-Cache', status)
  return result
}

/**
 * NuxtHub 0.10.8 reads R2 twice when serving an image (body + metadata). A warm edge entry skips
 * both. The route still runs, so Nitro applies current security/request-id headers on every hit.
 * Cache storage is optional and best effort; only its write runs after the response.
 */
export async function servePublicImage(request: Request, read: () => Promise<Response>, options: {
  waitUntil: (task: Promise<unknown>) => void
  openCache?: () => Promise<ImageCache>
}): Promise<Response> {
  if (!cacheableRequest(request)) return read()
  const openCache = options.openCache ?? (typeof caches === 'undefined' ? undefined : () => caches.open(CACHE_NAME))
  if (!openCache) return withCacheStatus(await read(), 'BYPASS')

  // The complete origin and tenant-prefixed path isolate environments and cafes. Credentials
  // never enter the cache key. Menu images are deliberately public, also for signed-in visitors.
  const key = new Request(request.url)
  let cache: ImageCache
  try {
    cache = await openCache()
    const hit = await cache.match(key)
    if (hit) {
      const response = withCacheStatus(hit, 'HIT')
      response.headers.set('Cache-Control', PUBLIC_IMAGE_BROWSER_CACHE)
      return response
    }
  }
  catch {
    log('warn', 'Public image cache read unavailable')
    return withCacheStatus(await read(), 'BYPASS')
  }

  const response = await read()
  if (!cacheableResponse(response)) return withCacheStatus(response, 'BYPASS')

  // Store only representation headers. Per-request ids, cookies, diagnostics and security
  // policy must never be replayed from another invocation. Edge expiry is one hour, independent
  // of the existing one-year browser policy. New photo edits already receive new object keys.
  const headers = new Headers({ 'Cache-Control': `public, max-age=${EDGE_TTL_SECONDS}` })
  for (const name of ['Content-Type', 'Content-Length', 'ETag', 'Last-Modified', 'X-Content-Type-Options']) {
    const value = response.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const stored = new Response(response.clone().body, { headers })
  options.waitUntil(cache.put(key, stored).catch(() => {
    log('warn', 'Public image cache write unavailable')
  }))
  return withCacheStatus(response, 'MISS')
}
