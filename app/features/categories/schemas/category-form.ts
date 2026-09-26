import type { Category, CreateCategoryBody, UpdateCategoryBody } from '#shared/contracts/menu'
import * as v from 'valibot'

/** Form rules, with user-facing messages (the server checks the same limits). */
export const categoryFormSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(100, 'Max 100 characters')),
  /** `undefined`: a main category. */
  parentId: v.optional(v.string()),
  status: v.picklist(['ACTIVE', 'INACTIVE']),
})

export type CategoryForm = v.InferOutput<typeof categoryFormSchema>

/** Initial form state, from an existing category or defaults for a new one. */
export function toCategoryForm(category?: Category): CategoryForm {
  return {
    name: category?.name ?? '',
    parentId: category?.parentId ?? undefined,
    status: category?.status ?? 'ACTIVE',
  }
}

export function toCreateCategoryBody(form: CategoryForm): CreateCategoryBody {
  return { name: form.name, parentId: form.parentId ?? null, status: form.status }
}

/**
 * Update body: every field the form edits, from the version the form was opened with. No parent
 * is sent as `null`, which the API defines as "clear" (a sub-category becomes a main one).
 */
export function toUpdateCategoryBody(form: CategoryForm, existing: Category): UpdateCategoryBody {
  return { version: existing.version, name: form.name, parentId: form.parentId ?? null, status: form.status }
}
