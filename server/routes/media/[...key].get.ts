import { isPublicMediaKey, PUBLIC_IMAGE_BROWSER_CACHE, servePublicImage } from '#server/features/media'

/**
 * Serves stored menu images. Keys are random (`t/<tenantId>/menu/<uuid>.<ext>`, or `menu/<uuid>.<ext>`
 * from before D136) and menu images are public content (the customer menu shows them too). Nothing
 * else is served from here.
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') ?? ''
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  if (!isPublicMediaKey(key)) throw createError({ statusCode: 404 })
  return servePublicImage(toWebRequest(event), async () => {
    const body = await blob.serve(event, key)
    // Only a successful read gets a long browser lifetime. Preserve NuxtHub's type/length/ETag.
    setHeader(event, 'Cache-Control', PUBLIC_IMAGE_BROWSER_CACHE)
    const headers = new Headers()
    for (const [name, value] of Object.entries(getResponseHeaders(event))) {
      if (Array.isArray(value)) value.forEach(item => headers.append(name, item))
      else if (value !== undefined) headers.set(name, String(value))
    }
    return new Response(body, { headers })
  }, { waitUntil: task => event.waitUntil(task) })
})
