/**
 * Serves stored menu images. Keys are random (`menu/<uuid>.<ext>`) and menu images are public
 * content (the customer menu shows them too). Nothing outside `menu/` is served from here.
 */
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') ?? ''
  if (!/^menu\/[\w-]+\.(?:jpg|png|webp)$/.test(key)) throw createError({ statusCode: 404 })
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return blob.serve(event, key)
})
