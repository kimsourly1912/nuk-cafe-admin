import type { CreateCategoryInput, MenuCategory, UpdateCategoryInput } from '#shared/contracts/menu-categories'
import { CATEGORY_DESCRIPTION_MAX, CATEGORY_NAME_MAX } from '#shared/contracts/menu-categories'
import * as v from 'valibot'

/** Form rules, with user-facing messages (the server checks the same limits). */
export const categoryFormSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(CATEGORY_NAME_MAX, `Max ${CATEGORY_NAME_MAX} characters`)),
  description: v.pipe(v.string(), v.trim(), v.maxLength(CATEGORY_DESCRIPTION_MAX, `Max ${CATEGORY_DESCRIPTION_MAX} characters`)),
  /** `undefined`: a main category. */
  parentId: v.optional(v.string()),
  availabilityRuleIds: v.array(v.string()),
})

export type CategoryForm = v.InferOutput<typeof categoryFormSchema>

/** Initial form state, from an existing category or defaults for a new one. */
export function toCategoryForm(category?: MenuCategory): CategoryForm {
  return {
    name: category?.name ?? '',
    description: category?.description ?? '',
    parentId: category?.parentId ?? undefined,
    availabilityRuleIds: category?.availabilityRules.map(r => r.id) ?? [],
  }
}

export function toCreateCategoryBody(form: CategoryForm): CreateCategoryInput {
  return { name: form.name.trim(), description: form.description.trim(), parentId: form.parentId ?? null, availabilityRuleIds: [...form.availabilityRuleIds] }
}

/**
 * Update body: every field the form edits, from the version the form was opened with. No parent
 * is sent as `null`, which the API defines as "move to the top level"; the rules replace the
 * category's rules.
 */
export function toUpdateCategoryBody(form: CategoryForm, existing: MenuCategory): UpdateCategoryInput {
  return { version: existing.version, ...toCreateCategoryBody(form) }
}
