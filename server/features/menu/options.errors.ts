import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import { apiError, ErrorCodes, notFound, versionConflict } from '../../utils/errors'

export const OptionErrorCodes = {
  OPTION_SET_NAME_TAKEN: 'OPTION_SET_NAME_TAKEN',
  OPTION_VALUE_NAME_TAKEN: 'OPTION_VALUE_NAME_TAKEN',
  LAST_OPTION_VALUE: 'LAST_OPTION_VALUE',
  TOO_MANY_OPTION_VALUES: 'TOO_MANY_OPTION_VALUES',
} as const

export const optionSetNotFound = () => notFound('This option set')

export const optionValueNotFound = () => notFound('This option value')

export const optionSetChanged = () => versionConflict('This option set')

export const optionSetNameTaken = (name: string) =>
  apiError(409, OptionErrorCodes.OPTION_SET_NAME_TAKEN, `There is already an option set named "${name}".`, {
    fieldErrors: { name: ['Already used by another option set'] },
  })

export const optionValueNameTaken = (name: string) =>
  apiError(409, OptionErrorCodes.OPTION_VALUE_NAME_TAKEN, `This set already has a value named "${name}".`, {
    fieldErrors: { name: ['Already used in this set'] },
  })

/** A set always keeps at least one active value (an item's versions come from them). */
export const lastOptionValue = () =>
  apiError(422, OptionErrorCodes.LAST_OPTION_VALUE, 'An option set needs at least one value. Archive the set instead.')

export const tooManyOptionValues = () =>
  apiError(422, OptionErrorCodes.TOO_MANY_OPTION_VALUES, `An option set can have at most ${MAX_OPTION_VALUES} active values.`)

export const optionSetArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This option set is archived. Restore it first.')

export const optionNotArchived = (what: 'set' | 'value') =>
  apiError(409, ErrorCodes.INVALID_STATE, `This option ${what} isn't archived.`)

export const optionValueArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This option value is archived. Restore it first.')

/** A reorder that doesn't list exactly the set's active values. */
export const optionValuesChanged = () =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, 'The values of this option set changed. Reload it and try again.')
