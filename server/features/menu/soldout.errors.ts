import { apiError } from '../../utils/errors'

export const SoldOutErrorCodes = {
  VARIATION_NOT_AVAILABLE: 'VARIATION_NOT_AVAILABLE',
} as const

/** A version that doesn't exist, was removed from its item's grid, or whose item is archived. */
export const variationNotAvailable = (index: number) =>
  apiError(422, SoldOutErrorCodes.VARIATION_NOT_AVAILABLE, 'That version isn\'t on the menu any more. Reload the menu and try again.', {
    fieldErrors: { [`variationIds.${index}`]: ['Not on the menu'] },
  })
