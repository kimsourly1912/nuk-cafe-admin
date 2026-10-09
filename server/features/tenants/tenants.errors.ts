import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const TenantErrorCodes = {
  /** The address is a cafe's, now or before (old addresses keep redirecting to their cafe). */
  SLUG_TAKEN: 'SLUG_TAKEN',
  /** The new owner's email is an existing owner's: choose them from the list (D146). */
  OWNER_EXISTS: 'OWNER_EXISTS',
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

/** "An existing owner" names someone who doesn't own a cafe (or whose account is disabled). */
export const notAnOwner = () =>
  apiError(422, ErrorCodes.VALIDATION_FAILED, 'Choose someone who owns a cafe.', {
    fieldErrors: { 'owner.userId': ['This person doesn\'t own a cafe'] },
  })

/** "A new person" with the email of someone who already owns a cafe: they're chosen from the list instead (D146). */
export const ownerExists = (name: string) =>
  apiError(409, TenantErrorCodes.OWNER_EXISTS, `${name} already owns a cafe. Choose them under An existing owner.`, {
    fieldErrors: { 'owner.email': [`${name} already owns a cafe: choose An existing owner`] },
  })
