import { apiError, ErrorCodes, notFound } from '#server/utils/errors'

export const unauthenticated = () => apiError(401, ErrorCodes.UNAUTHENTICATED, 'Sign in to continue.')

export const forbidden = () => apiError(403, ErrorCodes.FORBIDDEN, 'You don\'t have permission to do this.')

export const IdentityErrorCodes = {
  NOT_ADMIN: 'NOT_ADMIN',
  /** Signed in, but not working at any branch: no counter app (D102). */
  NOT_STAFF: 'NOT_STAFF',
  /** The cafe in the path is paused by the platform (D134, D140). */
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  /** Signed in, but not on the platform team: no platform console (D142). */
  NOT_PLATFORM_ADMIN: 'NOT_PLATFORM_ADMIN',
  /** A super admin without two-step sign-in: the console asks them to set it up first (P1b, D188). */
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  /** Have I Been Pwned didn't answer: the new-password field's live check waits for the save (D210). */
  PASSWORD_CHECK_UNAVAILABLE: 'PASSWORD_CHECK_UNAVAILABLE',
  /** Deleting an account (D237): the password given isn't the account's. */
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  /** Deleting an account that still works in a cafe, or runs the platform (D237). */
  ACCOUNT_HAS_ACCESS: 'ACCOUNT_HAS_ACCESS',
  /** Deleting an account with an order still waiting for payment, being made or ready (D237). */
  ORDER_IN_PROGRESS: 'ORDER_IN_PROGRESS',
  /** A workspace session older than a day from sign-in (D243): signed out, sign in again. */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
} as const

export const sessionExpired = () =>
  apiError(401, IdentityErrorCodes.SESSION_EXPIRED, 'Your sign-in has ended. Sign in again.')

export const passwordCheckUnavailable = () =>
  apiError(503, IdentityErrorCodes.PASSWORD_CHECK_UNAVAILABLE, 'The password can\'t be checked right now. It\'s checked when you save.')

/** Signed in, but not an owner of the cafe: the admin app is owners only for now (D52, D134). */
export const notAdmin = () =>
  apiError(403, IdentityErrorCodes.NOT_ADMIN, 'This account doesn\'t have access to the admin app.')

/** Signed in, but not a super admin: the platform console is the platform team's (D142). */
export const notPlatformAdmin = () =>
  apiError(403, IdentityErrorCodes.NOT_PLATFORM_ADMIN, 'This account doesn\'t have access to the platform console.')

export const twoFactorRequired = () =>
  apiError(403, IdentityErrorCodes.TWO_FACTOR_REQUIRED, 'Set up two-step sign-in to use the platform console.')

export const passwordChangeRequired = () =>
  apiError(403, ErrorCodes.PASSWORD_CHANGE_REQUIRED, 'Change your temporary password to continue.')

/** Also for branches the caller isn't a member of: other people's records are 404 (security.md). */
export const branchNotFound = () => notFound('The branch')

export const notStaff = () =>
  apiError(403, IdentityErrorCodes.NOT_STAFF, 'This account doesn\'t work at any branch, so it can\'t use the counter.')

/** No tenant with that address (or, for the tasks' default, an empty database). D134, D140. */
export const tenantNotFound = () => notFound('The cafe')

/** A tenant the platform has paused: nothing in it answers until it's resumed (D134, D140). */
export const tenantSuspended = () =>
  apiError(403, IdentityErrorCodes.TENANT_SUSPENDED, 'This cafe is paused at the moment.')

// --- Deleting an account (D237) ---

export const wrongPassword = () =>
  apiError(400, IdentityErrorCodes.WRONG_PASSWORD, 'That password isn\'t right.', { fieldErrors: { password: ['That password isn\'t right'] } })

/** A guest has no password and nothing to delete by hand: the 90-day cleanup empties it (D236). */
export const guestCannotDelete = () =>
  apiError(403, ErrorCodes.FORBIDDEN, 'A guest has no account to delete.')

export const accountHasCafeAccess = () =>
  apiError(409, IdentityErrorCodes.ACCOUNT_HAS_ACCESS, 'You still work at a cafe. Ask its owner to remove your access first, then delete your account.')

export const platformAccountCannotDelete = () =>
  apiError(409, IdentityErrorCodes.ACCOUNT_HAS_ACCESS, 'A platform account can\'t delete itself. Ask another super admin to remove its role first.')

export const orderInProgress = () =>
  apiError(409, IdentityErrorCodes.ORDER_IN_PROGRESS, 'You have an order in progress. Delete your account once it\'s picked up or cancelled.')

/** The account changed between the checks and the write (access given, an order placed): nothing was deleted. */
export const accountChanged = () =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, 'Your account changed while it was being deleted. Nothing was deleted: try again.')
