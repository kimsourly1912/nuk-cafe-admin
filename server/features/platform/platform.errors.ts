import { apiError, ErrorCodes } from '#server/utils/errors'

export const idempotencyMismatch = () => apiError(422, ErrorCodes.IDEMPOTENCY_MISMATCH,
  'This request reuses the key of a different request. Start the action again.')

export const idempotencyKeyRequired = () => apiError(400, ErrorCodes.VALIDATION_FAILED,
  'The Idempotency-Key header is required and must be a UUID.')
