import { IMAGE_MAX_BYTES } from '#shared/contracts/menu'
import { checkImage, recordUpload } from '../../../../features/menu/media'

/**
 * Uploads a menu image (multipart, field `file`) to R2 and records it as a temporary asset.
 * A menu item references it by id when it is saved (`imageAssetId`).
 */
export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'media.write')
  // Checked before reading the body; the multipart envelope adds a little to the file size.
  if (Number(getHeader(event, 'content-length') ?? 0) > IMAGE_MAX_BYTES + 64 * 1024) {
    throw apiError(413, 'MEDIA_TOO_LARGE', `The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`)
  }
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename)
  if (!file) throw apiError(400, 'VALIDATION_FAILED', 'Choose an image to upload.', { file: ['Required'] })

  const { objectKey, mimeType } = checkImage({ type: file.type ?? '', size: file.data.length, head: file.data.subarray(0, 16) })
  await blob.put(objectKey, file.data, { contentType: mimeType })
  try {
    const uploaded = await recordUpload(useDb(), staff, { objectKey, mimeType, byteSize: file.data.length })
    setResponseStatus(event, 201)
    return uploaded
  }
  catch (error) {
    // No record points at the object: remove it now instead of leaving it behind.
    await blob.del(objectKey).catch(() => {})
    throw error
  }
})
