import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const PromotionErrorCodes = {
  PROMOTION_ENDED: 'PROMOTION_ENDED',
  PROMOTION_DATES_PASSED: 'PROMOTION_DATES_PASSED',
  PROMOTION_TARGET_NOT_AVAILABLE: 'PROMOTION_TARGET_NOT_AVAILABLE',
} as const

export const promotionNotFound = () => notFound('This promotion')

export const promotionChanged = () => versionConflict('This promotion')

/** An ended promotion is kept as it ran (orders name it): it can't be edited, published or ended again. */
export const promotionEnded = () =>
  apiError(409, PromotionErrorCodes.PROMOTION_ENDED, 'This promotion has ended. Create a new one to run it again.')

export const promotionNotDraft = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'Only a draft can be deleted. End a published promotion instead.')

export const promotionNotPublished = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'Only a published promotion can be ended.')

/** Publishing a promotion whose last day is already over would show customers nothing. */
export const promotionDatesPassed = () =>
  apiError(422, PromotionErrorCodes.PROMOTION_DATES_PASSED, 'This promotion\'s last day has passed. Choose a later end date.', {
    fieldErrors: { endsOn: ['The last day has passed'] },
  })

/** A chosen item, category or branch isn't this cafe's, or no longer sells (archived). */
export const promotionTargetNotAvailable = (field: 'itemIds' | 'categoryIds' | 'branchIds', index: number) => {
  const noun = field === 'itemIds' ? 'menu item' : field === 'categoryIds' ? 'category' : 'branch'
  return apiError(422, PromotionErrorCodes.PROMOTION_TARGET_NOT_AVAILABLE, `A ${noun} you chose doesn't exist or is archived.`, {
    fieldErrors: { [`${field}.${index}`]: [`Choose an active ${noun}`] },
  })
}
