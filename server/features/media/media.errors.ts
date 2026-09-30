import { IMAGE_MAX_BYTES } from '#shared/contracts/media'
import { apiError, ErrorCodes } from '#server/utils/errors'

export const MediaErrorCodes = {
  MEDIA_NOT_AVAILABLE: 'MEDIA_NOT_AVAILABLE',
} as const

export const unsupportedImage = () =>
  apiError(415, ErrorCodes.UNSUPPORTED_MEDIA, 'Use a JPEG, PNG or WebP image.', { fieldErrors: { file: ['Use a JPEG, PNG or WebP image'] } })

export const imageTooLarge = () =>
  apiError(413, ErrorCodes.PAYLOAD_TOO_LARGE, `The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`, { fieldErrors: { file: [`At most ${IMAGE_MAX_BYTES / 1024 / 1024} MB`] } })

export const noFile = () =>
  apiError(400, ErrorCodes.VALIDATION_FAILED, 'Choose an image to upload.', { fieldErrors: { file: ['Required'] } })

/**
 * The asset a record wants to use doesn't exist, is already used, or was cleaned up (uploads
 * unused for 24 hours are deleted). The feature attaching it throws this with its own field name.
 */
export const mediaNotAvailable = (field = 'imageId') =>
  apiError(422, MediaErrorCodes.MEDIA_NOT_AVAILABLE, 'This image is no longer available. Upload it again.', { fieldErrors: { [field]: ['Upload the image again'] } })
