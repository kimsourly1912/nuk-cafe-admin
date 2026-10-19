import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const TenantErrorCodes = {
  /** The address is a cafe's, now or before (old addresses keep redirecting to their cafe). */
  SLUG_TAKEN: 'SLUG_TAKEN',
  /** The new owner's email already has an account: choose it under "Use existing account" (D185). */
  ACCOUNT_EXISTS: 'ACCOUNT_EXISTS',
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

/** The chosen owner's account changed while the cafe was being saved (any other change to it). */
export const ownerAccountChanged = () =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, 'The owner\'s account changed while the cafe was being created. Nothing was saved: try again.')

/** "Use existing account" names an account that can't own a cafe: unknown, a guest or disabled. */
export const accountNotEligible = () =>
  apiError(422, ErrorCodes.VALIDATION_FAILED, 'Choose an account that can own a cafe.', {
    fieldErrors: { 'owner.userId': ['This account can\'t be chosen'] },
  })

/** "Create new account" with an email that has an account already (also one made while saving): it is chosen under "Use existing account" instead (D185). */
export const accountExists = () =>
  apiError(409, TenantErrorCodes.ACCOUNT_EXISTS, 'This email already has an account. Choose Use existing account to make them the owner.', {
    fieldErrors: { 'owner.email': ['This email already has an account: choose Use existing account'] },
  })

/** The email's account can't own a cafe (a guest or disabled account), so there is nothing to choose instead. */
export const emailUnavailable = () =>
  apiError(422, ErrorCodes.VALIDATION_FAILED, 'This email belongs to an account that can\'t own a cafe. Use another email.', {
    fieldErrors: { 'owner.email': ['This email belongs to an account that can\'t own a cafe'] },
  })
