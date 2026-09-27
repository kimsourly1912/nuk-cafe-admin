import { apiError, ErrorCodes, notFound } from '../../utils/errors'

export const unauthenticated = () => apiError(401, ErrorCodes.UNAUTHENTICATED, 'Sign in to continue.')

export const forbidden = () => apiError(403, ErrorCodes.FORBIDDEN, 'You don\'t have permission to do this.')

export const passwordChangeRequired = () =>
  apiError(403, ErrorCodes.PASSWORD_CHANGE_REQUIRED, 'Change your temporary password to continue.')

export const emailNotVerified = () =>
  apiError(403, ErrorCodes.EMAIL_NOT_VERIFIED, 'Verify your email address to continue.')

/** Also for branches the caller isn't a member of: other people's records are 404 (security.md). */
export const branchNotFound = () => notFound('The branch')
