/**
 * Serves stored menu images. Keys are random (`t/<tenantId>/menu/<uuid>.<ext>`, or `menu/<uuid>.<ext>`
 * from before D136) and menu images are public content (the customer menu shows them too). Nothing
 * else is served from here.
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') ?? ''
  if (!/^(?:t\/[\w-]+\/)?menu\/[\w-]+\.(?:jpg|png|webp)$/.test(key)) throw createError({ statusCode: 404 })
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return blob.serve(event, key)
})
