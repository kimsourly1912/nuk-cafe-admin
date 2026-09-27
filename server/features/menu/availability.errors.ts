import { apiError, ErrorCodes, notFound, versionConflict } from '../../utils/errors'

export const AvailabilityErrorCodes = {
  AVAILABILITY_RULE_NAME_TAKEN: 'AVAILABILITY_RULE_NAME_TAKEN',
  AVAILABILITY_WINDOWS: 'AVAILABILITY_WINDOWS',
  AVAILABILITY_RULE_IN_USE: 'AVAILABILITY_RULE_IN_USE',
  AVAILABILITY_RULE_NOT_AVAILABLE: 'AVAILABILITY_RULE_NOT_AVAILABLE',
} as const

export const availabilityRuleNotFound = () => notFound('This availability rule')

export const availabilityRuleChanged = () => versionConflict('This availability rule')

export const availabilityRuleNameTaken = (name: string) =>
  apiError(409, AvailabilityErrorCodes.AVAILABILITY_RULE_NAME_TAKEN, `There is already an availability rule named "${name}".`, {
    fieldErrors: { name: ['Already used by another availability rule'] },
  })

/** Overlapping windows (the contract checks each window on its own). */
export const availabilityWindows = (problem: { field: string, message: string }) =>
  apiError(422, AvailabilityErrorCodes.AVAILABILITY_WINDOWS, problem.message, { fieldErrors: { [problem.field]: [problem.message] } })

/**
 * Archiving a rule that items or categories use would stop selling them (an archived rule never
 * matches, D63), so it's refused until they stop using it.
 */
export const availabilityRuleInUse = (items: number, categories: number) => {
  const users = [
    ...(items ? [`${items} menu ${items === 1 ? 'item' : 'items'}`] : []),
    ...(categories ? [`${categories} ${categories === 1 ? 'category' : 'categories'}`] : []),
  ].join(' and ')
  return apiError(409, AvailabilityErrorCodes.AVAILABILITY_RULE_IN_USE, `This rule is used by ${users || 'the menu'}. Remove it from them first.`)
}

/** An item or category names a rule that doesn't exist or is archived (and it didn't use before). */
export const availabilityRuleNotAvailable = (index: number) =>
  apiError(422, AvailabilityErrorCodes.AVAILABILITY_RULE_NOT_AVAILABLE, 'That availability rule doesn\'t exist or is archived.', {
    fieldErrors: { [`availabilityRuleIds.${index}`]: ['Choose an active availability rule'] },
  })

export const availabilityRuleArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This availability rule is archived. Restore it first.')

export const availabilityRuleNotArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This availability rule isn\'t archived.')
