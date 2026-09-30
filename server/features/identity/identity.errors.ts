import { apiError, ErrorCodes, notFound } from '#server/utils/errors'

export const unauthenticated = () => apiError(401, ErrorCodes.UNAUTHENTICATED, 'Sign in to continue.')

export const forbidden = () => apiError(403, ErrorCodes.FORBIDDEN, 'You don\'t have permission to do this.')

export const IdentityErrorCodes = {
  NOT_ADMIN: 'NOT_ADMIN',
  /** Signed in, but not working at any branch: no counter app (D102). */
  NOT_STAFF: 'NOT_STAFF',
} as const

/** Signed in, but not a platform admin: the admin app is admins only for now (D52). */
export const notAdmin = () =>
  apiError(403, IdentityErrorCodes.NOT_ADMIN, 'This account doesn\'t have access to the admin app.')

export const passwordChangeRequired = () =>
  apiError(403, ErrorCodes.PASSWORD_CHANGE_REQUIRED, 'Change your temporary password to continue.')

export const emailNotVerified = () =>
  apiError(403, ErrorCodes.EMAIL_NOT_VERIFIED, 'Verify your email address to continue.')

/** Also for branches the caller isn't a member of: other people's records are 404 (security.md). */
export const branchNotFound = () => notFound('The branch')

export const notStaff = () =>
  apiError(403, IdentityErrorCodes.NOT_STAFF, 'This account doesn\'t work at any branch, so it can\'t use the counter.')
