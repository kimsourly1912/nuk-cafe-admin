import { IMAGE_MAX_BYTES } from '#shared/contracts/media'
import { uploadImage } from '#server/features/media'

/**
 * Uploads an image (multipart, field `file`): JPEG, PNG or WebP up to 5 MB, checked by its bytes.
 * 201 with the asset; it stays temporary until a record uses it, and is deleted after 24 hours if
 * none does.
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { media: ['upload'] })
  const parts = await readLimitedMultipart(event, IMAGE_MAX_BYTES + 64 * 1024)
  const part = parts?.find(p => p.name === 'file' && p.filename)
  const asset = await uploadImage(useDb(), blob, actor, part && { type: part.type ?? '', data: new Uint8Array(part.data) })
  setResponseStatus(event, 201)
  return asset
})
