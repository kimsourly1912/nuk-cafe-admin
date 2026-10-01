import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const StaffErrorCodes = {
  STAFF_ALREADY_EXISTS: 'STAFF_ALREADY_EXISTS',
  OWN_ACCESS: 'OWN_ACCESS',
  LAST_ADMIN: 'LAST_ADMIN',
} as const

export const staffNotFound = () => notFound('This staff member')

export const staffChanged = () => versionConflict('This staff member')

export const staffAlreadyExists = () =>
  apiError(409, StaffErrorCodes.STAFF_ALREADY_EXISTS, 'This person already has staff access. Edit them instead.', {
    fieldErrors: { email: ['Already a staff member'] },
  })

const OWN_ACCESS_MESSAGES = {
  'disable': 'You can\'t disable your own access. Ask another admin.',
  'remove admin': 'You can\'t remove your own admin role. Ask another admin.',
  'reset password': 'You can\'t reset your own password here. Use Change password in your account menu.',
} as const

export const ownAccess = (what: keyof typeof OWN_ACCESS_MESSAGES) => apiError(409, StaffErrorCodes.OWN_ACCESS, OWN_ACCESS_MESSAGES[what])

export const lastAdmin = () =>
  apiError(409, StaffErrorCodes.LAST_ADMIN, 'The cafe needs at least one admin. Make someone else an admin first.')

/** Memberships naming a branch that doesn't exist or is archived. */
export const unknownBranches = (indexes: number[]) => apiError(400, ErrorCodes.VALIDATION_FAILED, 'Some branches can\'t be used.', {
  fieldErrors: Object.fromEntries(indexes.map(i => [`memberships.${i}.branchId`, ['This branch doesn\'t exist or is archived']])),
})
