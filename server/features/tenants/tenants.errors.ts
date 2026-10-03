import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const TenantErrorCodes = {
  /** The address is a cafe's, now or before (old addresses keep redirecting to their cafe). */
  SLUG_TAKEN: 'SLUG_TAKEN',
} as const

export const tenantNotFound = () => notFound('The cafe')

export const tenantChanged = () => versionConflict('This cafe')

export const slugTaken = () =>
  apiError(409, TenantErrorCodes.SLUG_TAKEN, 'This web address is taken. Choose another one.', {
    fieldErrors: { slug: ['Already used by a cafe, now or before'] },
  })

export const sameSlug = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This is already the cafe\'s web address.', {
    fieldErrors: { slug: ['This is the current address'] },
  })

export const alreadySuspended = () => apiError(409, ErrorCodes.INVALID_STATE, 'This cafe is already paused.')

export const notSuspended = () => apiError(409, ErrorCodes.INVALID_STATE, 'This cafe isn\'t paused.')

/** The owner's email got an account, or that account changed, while the cafe was being saved. */
export const ownerAccountChanged = () =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, 'The owner\'s account changed while the cafe was being created. Nothing was saved: try again.')
