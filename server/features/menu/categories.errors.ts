import { apiError, ErrorCodes, notFound, versionConflict } from '../../utils/errors'

export const CategoryErrorCodes = {
  CATEGORY_NAME_TAKEN: 'CATEGORY_NAME_TAKEN',
  CATEGORY_DEPTH: 'CATEGORY_DEPTH',
  PARENT_NOT_AVAILABLE: 'PARENT_NOT_AVAILABLE',
  PARENT_ARCHIVED: 'PARENT_ARCHIVED',
} as const

export const categoryNotFound = () => notFound('This category')

export const categoryChanged = () => versionConflict('This category')

/** A reorder whose list doesn't match the current siblings (one was added, moved or changed). */
export const siblingsChanged = () =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, 'These categories were changed by someone else. Reload them and try again.')

export const categoryNameTaken = (name: string) =>
  apiError(409, CategoryErrorCodes.CATEGORY_NAME_TAKEN, `There is already a category named "${name}" here.`, {
    fieldErrors: { name: ['Already used by another category at this level'] },
  })

/** Two levels only: a sub-category can't have sub-categories, and one that has them can't become one. */
export const tooDeep = (reason: 'parent-is-sub' | 'has-children') =>
  apiError(422, CategoryErrorCodes.CATEGORY_DEPTH, reason === 'parent-is-sub'
    ? 'A sub-category can\'t have sub-categories of its own.'
    : 'This category has sub-categories, so it can\'t become a sub-category.', { fieldErrors: { parentId: ['Choose a top-level category'] } })

export const parentNotAvailable = () =>
  apiError(422, CategoryErrorCodes.PARENT_NOT_AVAILABLE, 'That category doesn\'t exist or is archived.', {
    fieldErrors: { parentId: ['Choose an active top-level category'] },
  })

export const categoryArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This category is archived. Restore it first.')

export const categoryNotArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This category isn\'t archived.')

export const parentArchived = () =>
  apiError(409, CategoryErrorCodes.PARENT_ARCHIVED, 'Its parent category is archived. Restore the parent first.')
