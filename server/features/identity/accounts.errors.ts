import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const AccountErrorCodes = {
  OWN_ACCOUNT: 'OWN_ACCOUNT',
  PLATFORM_ACCOUNT: 'PLATFORM_ACCOUNT',
  ALREADY_BANNED: 'ALREADY_BANNED',
  NOT_BANNED: 'NOT_BANNED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
} as const

export const accountNotFound = () => notFound('This account')

export const accountChanged = () => versionConflict('This account')

export const ownAccount = () =>
  apiError(409, AccountErrorCodes.OWN_ACCOUNT, 'You can\'t do this to your own account. Use your account menu, or ask another super admin.')

/** Another super admin: set by hand (operations.md → Super admins), never changed from the console. */
export const platformAccount = () =>
  apiError(409, AccountErrorCodes.PLATFORM_ACCOUNT, 'This is a super admin\'s account. It can\'t be changed from the console.')

export const alreadyBanned = () => apiError(409, AccountErrorCodes.ALREADY_BANNED, 'This account is already banned.')

export const notBanned = () => apiError(409, AccountErrorCodes.NOT_BANNED, 'This account isn\'t banned.')

/** A temporary password for a banned account would be one nobody can use: unban it first. */
export const accountBanned = () =>
  apiError(409, AccountErrorCodes.ACCOUNT_BANNED, 'This account is banned. Unban it first.')

export const banEndInPast = () => apiError(400, ErrorCodes.VALIDATION_FAILED, 'The ban must end in the future.', {
  fieldErrors: { until: ['Choose a time in the future'] },
})
