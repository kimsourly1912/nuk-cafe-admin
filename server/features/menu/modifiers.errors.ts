import { apiError, ErrorCodes, notFound, versionConflict } from '../../utils/errors'

export const ModifierErrorCodes = {
  MODIFIER_GROUP_NAME_TAKEN: 'MODIFIER_GROUP_NAME_TAKEN',
  MODIFIER_NAME_TAKEN: 'MODIFIER_NAME_TAKEN',
  SELECTION_RULES: 'SELECTION_RULES',
} as const

export const modifierGroupNotFound = () => notFound('This add-on group')

export const modifierNotFound = () => notFound('This add-on')

export const modifierGroupChanged = () => versionConflict('This add-on group')

export const modifierGroupNameTaken = (name: string) =>
  apiError(409, ModifierErrorCodes.MODIFIER_GROUP_NAME_TAKEN, `There is already an add-on group named "${name}".`, {
    fieldErrors: { name: ['Already used by another add-on group'] },
  })

export const modifierNameTaken = (name: string) =>
  apiError(409, ModifierErrorCodes.MODIFIER_NAME_TAKEN, `This group already has an add-on named "${name}".`, {
    fieldErrors: { name: ['Already used in this group'] },
  })

/** The group's selection rules couldn't be met after the change (see `selectionProblem`). */
export const selectionRules = (problem: { field: string, message: string }) =>
  apiError(422, ModifierErrorCodes.SELECTION_RULES, problem.message, { fieldErrors: { [problem.field]: [problem.message] } })

export const modifierGroupArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This add-on group is archived. Restore it first.')

export const modifierArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This add-on is archived. Restore it first.')

export const modifierNotArchived = (what: 'group' | 'add-on') =>
  apiError(409, ErrorCodes.INVALID_STATE, `This ${what === 'group' ? 'add-on group' : 'add-on'} isn't archived.`)

export const modifiersChanged = () =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, 'The add-ons of this group changed. Reload it and try again.')
