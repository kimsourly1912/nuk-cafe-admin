import type { ProductRecordUpdate, ProductResponse, ProductVariant, ProductVariantResponse } from '~/generated/api'
import * as v from 'valibot'
import { roundPrice } from '../utils/money'

/** Our own upper bound, a typo guard ([Choice], docs/plans/products.md). */
export const MAX_PRICE = 10_000

/**
 * Form rules. Generated request schemas carry no validation, so the user-facing rules live here.
 * `categoryId` and `price` start `undefined` in a new form, so "required" is checked here too.
 */
export const productFormSchema = v.object({
  productName: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(100, 'Max 100 characters')),
  categoryId: v.pipe(v.optional(v.number()), v.check(id => id !== undefined, 'Category is required')),
  price: v.pipe(
    v.optional(v.number()),
    v.check(price => price !== undefined && !Number.isNaN(price), 'Price is required'),
    v.check(price => price === undefined || (price >= 0 && price <= MAX_PRICE), `Between $0 and $${MAX_PRICE.toLocaleString('en-US')}`),
  ),
  description: v.pipe(v.string(), v.trim(), v.maxLength(500, 'Max 500 characters')),
  scheduleIds: v.array(v.number()),
  status: v.picklist(['ACTIVE', 'INACTIVE']),
  imageUrl: v.optional(v.string()),
  imageUuid: v.optional(v.string()),
})

export type ProductForm = v.InferOutput<typeof productFormSchema>

/** Initial form state, from an existing product (a list row) or defaults for a new one. */
export function toProductForm(product?: ProductResponse): ProductForm {
  return {
    productName: product?.productName ?? '',
    categoryId: product?.category?.id,
    price: product?.price,
    description: product?.description ?? '',
    scheduleIds: [...(product?.scheduleIds ?? [])],
    status: product?.status ?? 'ACTIVE',
    imageUrl: product?.imageUrl,
    imageUuid: product?.imageUuid,
  }
}

const bySortOrder = <T extends { sortOrder?: number }>(list: T[] = []) =>
  [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

/** A variant from the response, as the request expects it: same ids, order kept (plan P2). */
export function toVariantRequest(variant: ProductVariantResponse): ProductVariant {
  return {
    id: variant.id,
    variantName: variant.variantName,
    requiredSelection: variant.requiredSelection,
    allowMultipleSelection: variant.allowMultipleSelection,
    nameI18n: variant.nameI18n,
    options: bySortOrder(variant.options).map(option => ({
      id: option.id,
      optionName: option.optionName,
      price: option.price,
      labelI18n: option.labelI18n,
    })),
  }
}

/**
 * Request body for create/update (same shape). Everything is sent explicitly; nothing relies on
 * an omitted field meaning "keep" (docs/plans/products.md P2–P7):
 * - `variants` are re-sent unchanged from `existing` (the form doesn't edit them yet). New: `[]`.
 * - `imageUrl` / `imageUuid`: the current image, or the one just uploaded.
 * - `nameI18n` / `descriptionI18n` are copied (the form edits English only, Q5).
 * - `price` is rounded to cents.
 */
export function toProductRequest(form: ProductForm, existing?: ProductResponse): ProductRecordUpdate {
  return {
    productName: form.productName,
    categoryId: form.categoryId,
    price: form.price === undefined ? undefined : roundPrice(form.price),
    description: form.description,
    scheduleIds: [...form.scheduleIds],
    status: form.status,
    imageUrl: form.imageUrl,
    imageUuid: form.imageUuid,
    variants: bySortOrder(existing?.variants).map(toVariantRequest),
    nameI18n: existing?.nameI18n,
    descriptionI18n: existing?.descriptionI18n,
  }
}
