import { apiError, ErrorCodes, notFound } from '#server/utils/errors'

export const SupportErrorCodes = {
  /** A write during a support visit: support is read-only (D193). */
  SUPPORT_READ_ONLY: 'SUPPORT_READ_ONLY',
  /** The cafe's owner hasn't allowed support, or it ended. */
  SUPPORT_NOT_ALLOWED: 'SUPPORT_NOT_ALLOWED',
  SUPPORT_ALREADY_ALLOWED: 'SUPPORT_ALREADY_ALLOWED',
  INVALID_CODE: 'INVALID_CODE',
} as const

export const supportReadOnly = () =>
  apiError(403, SupportErrorCodes.SUPPORT_READ_ONLY, 'Support access is read-only: nothing can be changed.')

/** A read support may not make (an export, the assistant): the same refusal as any other missing permission. */
export const supportNotPermitted = () =>
  apiError(403, ErrorCodes.FORBIDDEN, 'Support access can\'t open this.')

export const supportNotAllowed = () =>
  apiError(409, SupportErrorCodes.SUPPORT_NOT_ALLOWED, 'The cafe\'s owner hasn\'t allowed platform support, or it has ended.')

export const supportAlreadyAllowed = () =>
  apiError(409, SupportErrorCodes.SUPPORT_ALREADY_ALLOWED, 'Platform support is already allowed.')

export const grantNotFound = () => notFound('This support access')

export const invalidCode = () =>
  apiError(422, SupportErrorCodes.INVALID_CODE, 'That code isn\'t right. Check your app and try again.', {
    fieldErrors: { code: ['That code isn\'t right'] },
  })

export const tooManyCodes = () =>
  apiError(429, ErrorCodes.RATE_LIMITED, 'Too many wrong codes. Wait 15 minutes and try again.')
