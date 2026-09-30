import { IMAGE_MAX_BYTES } from '#shared/contracts/media'
import { uploadImage } from '#server/features/media'

/**
 * Uploads an image (multipart, field `file`): JPEG, PNG or WebP up to 5 MB, checked by its bytes.
 * 201 with the asset; it stays temporary until a record uses it, and is deleted after 24 hours if
 * none does.
 */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { media: ['upload'] })
  // Refused before the body is read; the multipart envelope adds a little to the file itself.
  if (Number(getHeader(event, 'content-length') ?? 0) > IMAGE_MAX_BYTES + 64 * 1024) {
    throw apiError(413, 'PAYLOAD_TOO_LARGE', `The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`)
  }
  const parts = await readMultipartFormData(event)
  const part = parts?.find(p => p.name === 'file' && p.filename)
  const asset = await uploadImage(useDb(), blob, actor, part && { type: part.type ?? '', data: new Uint8Array(part.data) })
  setResponseStatus(event, 201)
  return asset
})
