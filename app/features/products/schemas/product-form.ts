import type { ProductRecordUpdate, ProductResponse, ProductVariant, ProductVariantResponse } from '~/generated/api'
import * as v from 'valibot'
import { roundPrice } from '../utils/money'

/** Our own upper bound, a typo guard ([Choice], docs/plans/products.md). */
export const MAX_PRICE = 10_000

const RANGE_MESSAGE = `Between $0 and $${MAX_PRICE.toLocaleString('en-US')}`

/** A required price in dollars. Starts `undefined` in a new form, so "required" is checked here. */
const priceSchema = v.pipe(
  v.optional(v.number()),
  v.check(price => price !== undefined && !Number.isNaN(price), 'Price is required'),
  v.check(price => price === undefined || (price >= 0 && price <= MAX_PRICE), RANGE_MESSAGE),
)

const nameSchema = (label: string) =>
  v.pipe(v.string(), v.trim(), v.minLength(1, `${label} is required`), v.maxLength(100, 'Max 100 characters'))

/**
 * `key` identifies a row in the editor (v-for, drag and drop). It's derived from the id for saved
 * rows, so a form's initial and current state compare equal until something changes, and is
 * never sent.
 */
const optionSchema = v.object({
  key: v.string(),
  id: v.optional(v.number()),
  optionName: nameSchema('Option name'),
  price: priceSchema,
})

const variantSchema = v.object({
  key: v.string(),
  id: v.optional(v.number()),
  variantName: nameSchema('Group name'),
  requiredSelection: v.boolean(),
  allowMultipleSelection: v.boolean(),
  options: v.pipe(v.array(optionSchema), v.minLength(1, 'Add at least one option')),
})

/**
 * Form rules. Generated request schemas carry no validation, so the user-facing rules live here.
 * `categoryId` and `price` start `undefined` in a new form, so "required" is checked here too.
 */
export const productFormSchema = v.object({
  productName: nameSchema('Name'),
  categoryId: v.pipe(v.optional(v.number()), v.check(id => id !== undefined, 'Category is required')),
  price: priceSchema,
  description: v.pipe(v.string(), v.trim(), v.maxLength(500, 'Max 500 characters')),
  scheduleIds: v.array(v.number()),
  status: v.picklist(['ACTIVE', 'INACTIVE']),
  imageUrl: v.optional(v.string()),
  imageUuid: v.optional(v.string()),
  variants: v.array(variantSchema),
})

export type ProductForm = v.InferOutput<typeof productFormSchema>
export type VariantForm = ProductForm['variants'][number]
export type VariantOptionForm = VariantForm['options'][number]

let newKeys = 0
const newKey = (kind: string) => `${kind}:new:${++newKeys}`

/** An empty option row: free by default (most options in the data cost nothing extra). */
export function newOption(): VariantOptionForm {
  return { key: newKey('option'), id: undefined, optionName: '', price: 0 }
}

/** An empty group with one option, "pick one" and optional by default. */
export function newVariant(): VariantForm {
  return { key: newKey('variant'), id: undefined, variantName: '', requiredSelection: false, allowMultipleSelection: false, options: [newOption()] }
}

const bySortOrder = <T extends { sortOrder?: number }>(list: T[] = []) =>
  [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

function toVariantForm(variant: ProductVariantResponse): VariantForm {
  return {
    key: `variant:${variant.id}`,
    id: variant.id,
    variantName: variant.variantName ?? '',
    requiredSelection: variant.requiredSelection ?? false,
    allowMultipleSelection: variant.allowMultipleSelection ?? false,
    options: bySortOrder(variant.options).map(option => ({
      key: `option:${option.id}`,
      id: option.id,
      optionName: option.optionName ?? '',
      price: option.price ?? 0,
    })),
  }
}

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
    variants: bySortOrder(product?.variants).map(toVariantForm),
  }
}

/**
 * The variants as edited, for the request (plan P2, D35): the **complete** list in the order shown.
 * Kept groups and options carry their ids, new ones have none, removed ones are left out (the
 * API has no other way to say "remove"). Their translations are copied from `existing` by id.
 */
function toVariantsRequest(variants: VariantForm[], existing?: ProductResponse): ProductVariant[] {
  return variants.map((variant) => {
    const before = variant.id === undefined ? undefined : existing?.variants?.find(x => x.id === variant.id)
    return {
      id: variant.id,
      variantName: variant.variantName,
      requiredSelection: variant.requiredSelection,
      allowMultipleSelection: variant.allowMultipleSelection,
      nameI18n: before?.nameI18n,
      options: variant.options.map((option) => {
        const previous = option.id === undefined ? undefined : before?.options?.find(x => x.id === option.id)
        return {
          id: option.id,
          optionName: option.optionName,
          price: roundPrice(option.price ?? 0),
          labelI18n: previous?.labelI18n,
        }
      }),
    }
  })
}

/**
 * Request body for create/update (same shape). Everything is sent explicitly; nothing relies on
 * an omitted field meaning "keep" (docs/plans/products.md P2–P7):
 * - `variants`: the complete edited list (see `toVariantsRequest`).
 * - `imageUrl` / `imageUuid`: the current image, or the one just uploaded.
 * - `nameI18n` / `descriptionI18n` are copied (the form edits English only, Q5).
 * - Prices are rounded to cents.
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
    variants: toVariantsRequest(form.variants, existing),
    nameI18n: existing?.nameI18n,
    descriptionI18n: existing?.descriptionI18n,
  }
}

/**
 * What the server saved differs from what was sent: the only way to notice a backend that ignores
 * a removal (Q18). Compared **by name and order**, not by id, because a backend that replaces all
 * variants would give kept ones new ids. Returns user-facing problems, empty when they match or
 * when the response has no variants to compare.
 */
export function variantMismatches(sent: ProductVariant[] = [], saved?: ProductVariantResponse[]): string[] {
  if (!saved) return []
  const problems: string[] = []
  /** `label` names one entry; `what` names the whole list (for the order message). */
  const compare = (want: string[], got: string[], label: (name: string) => string, what: string) => {
    for (const name of got) if (!want.includes(name)) problems.push(`${label(name)} is still there`)
    for (const name of want) if (!got.includes(name)) problems.push(`${label(name)} is missing`)
    const sameSet = want.length === got.length && want.every(n => got.includes(n))
    if (sameSet && want.some((n, i) => n !== got[i])) problems.push(`The order of ${what} wasn't saved`)
  }
  const savedVariants = bySortOrder(saved)
  compare(sent.map(x => x.variantName ?? ''), savedVariants.map(x => x.variantName ?? ''), name => `"${name}"`, 'the groups')
  for (const variant of sent) {
    const match = savedVariants.find(x => x.variantName === variant.variantName)
    if (!match) continue
    compare(
      (variant.options ?? []).map(o => o.optionName ?? ''),
      bySortOrder(match.options).map(o => o.optionName ?? ''),
      name => `"${variant.variantName} › ${name}"`,
      `the options in "${variant.variantName}"`,
    )
  }
  return problems
}
