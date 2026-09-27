import { apiError, ErrorCodes, notFound, versionConflict } from '../../utils/errors'

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

export const ownAccess = (what: 'remove admin' | 'disable') => apiError(409, StaffErrorCodes.OWN_ACCESS, what === 'disable'
  ? 'You can\'t disable your own access. Ask another admin.'
  : 'You can\'t remove your own admin role. Ask another admin.')

export const lastAdmin = () =>
  apiError(409, StaffErrorCodes.LAST_ADMIN, 'The cafe needs at least one admin. Make someone else an admin first.')

/** Memberships naming a branch that doesn't exist or is archived. */
export const unknownBranches = (indexes: number[]) => apiError(400, ErrorCodes.VALIDATION_FAILED, 'Some branches can\'t be used.', {
  fieldErrors: Object.fromEntries(indexes.map(i => [`memberships.${i}.branchId`, ['This branch doesn\'t exist or is archived']])),
})
