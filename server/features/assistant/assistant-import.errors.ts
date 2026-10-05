import { apiError, notFound } from '#server/utils/errors'

export const importNotFound = () => notFound('This import source')
export const importTooLarge = () => apiError(413, 'PAYLOAD_TOO_LARGE', 'Choose a file no larger than 5 MB.')
export const importUnsupported = () => apiError(415, 'UNSUPPORTED_MEDIA', 'Choose a JPEG, PNG, WebP or PDF whose file type matches its contents.')
export const importInvalid = (message: string) => apiError(400, 'VALIDATION_FAILED', message)
export const importSourceLimit = () => apiError(429, 'AI_IMPORT_SOURCE_LIMIT', 'You already have five private import sources. Discard one before uploading another.')
export const importStorageUnavailable = () => apiError(500, 'AI_IMPORT_NOT_CONFIGURED', 'Private import storage is not configured.')
