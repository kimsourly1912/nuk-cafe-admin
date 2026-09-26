import type { CategoryRecordUpdate, CategoryResponse } from '~/generated/api'
import * as v from 'valibot'

/**
 * Form rules. Generated request schemas carry no validation, so the user-facing rules live here.
 */
export const categoryFormSchema = v.object({
  categoryName: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(100, 'Max 100 characters')),
  mainCategoryId: v.optional(v.number()),
  status: v.picklist(['ACTIVE', 'INACTIVE']),
})

export type CategoryForm = v.InferOutput<typeof categoryFormSchema>

/** Initial form state, from an existing category or defaults for a new one. */
export function toCategoryForm(category?: CategoryResponse): CategoryForm {
  return {
    categoryName: category?.categoryName ?? '',
    mainCategoryId: category?.mainCategoryId,
    status: category?.status ?? 'ACTIVE',
  }
}

/**
 * Request body for create/update. Fields the form doesn't edit are copied from `existing`
 * so a PUT doesn't wipe them.
 */
export function toCategoryRequest(form: CategoryForm, existing?: CategoryResponse): CategoryRecordUpdate {
  return {
    categoryName: form.categoryName,
    mainCategoryId: form.mainCategoryId,
    status: form.status,
    nameI18n: existing?.nameI18n,
    sortOrder: existing?.sortOrder,
  }
}
