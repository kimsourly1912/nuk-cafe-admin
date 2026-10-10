import { photoSourceKey } from '#server/features/media'

/**
 * A menu photo's private source (D158), for the photo editor only: the cafe's admins, never cached
 * by anyone else. `/media/…` doesn't serve it.
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { media: ['upload'] })
  const { objectKey, mimeType } = await photoSourceKey(useDb(), actor.tenantId, readIdParam(event, 'id', 'This photo'))
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Content-Type', mimeType)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return blob.serve(event, objectKey)
})
