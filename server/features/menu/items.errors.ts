import { apiError, ErrorCodes, notFound, versionConflict } from '../../utils/errors'

export const ItemErrorCodes = {
  CATEGORY_NOT_A_LEAF: 'CATEGORY_NOT_A_LEAF',
  CATEGORY_NOT_AVAILABLE: 'CATEGORY_NOT_AVAILABLE',
  OPTION_SET_NOT_AVAILABLE: 'OPTION_SET_NOT_AVAILABLE',
  PRICE_GRID: 'PRICE_GRID',
  NOTHING_TO_SELL: 'NOTHING_TO_SELL',
} as const

export const itemNotFound = () => notFound('This menu item')

export const itemChanged = () => versionConflict('This menu item')

export const categoryNotAvailable = () =>
  apiError(422, ItemErrorCodes.CATEGORY_NOT_AVAILABLE, 'That category doesn\'t exist or is archived.', { fieldErrors: { categoryId: ['Choose an active category'] } })

/** Items go in leaf categories only (D44): a category holds sub-categories or items, never both. */
export const categoryNotALeaf = () =>
  apiError(422, ItemErrorCodes.CATEGORY_NOT_A_LEAF, 'That category has sub-categories; put the item in one of them.', { fieldErrors: { categoryId: ['Choose a category without sub-categories'] } })

export const optionSetNotAvailable = (index: number) =>
  apiError(422, ItemErrorCodes.OPTION_SET_NOT_AVAILABLE, 'That option set doesn\'t exist or is archived.', { fieldErrors: { [`optionSetIds.${index}`]: ['Choose an active option set'] } })

export const priceGrid = (problem: { field: string, message: string }) =>
  apiError(422, ItemErrorCodes.PRICE_GRID, problem.message, { fieldErrors: { [problem.field]: [problem.message] } })

/** Publishing needs something to sell. */
export const nothingToSell = () =>
  apiError(422, ItemErrorCodes.NOTHING_TO_SELL, 'Switch on and price at least one version before publishing.')

export const itemInWrongState = (message: string) => apiError(409, ErrorCodes.INVALID_STATE, message)

export const itemsChanged = () =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, 'The items of this category changed. Reload them and try again.')
