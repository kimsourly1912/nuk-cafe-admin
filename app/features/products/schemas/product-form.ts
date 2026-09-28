import type { CreateProductBody, Product, UpdateProductBody, VariantGroup, VariantGroupInput } from '#shared/contracts/menu'
import { MAX_PRICE_MINOR } from '#shared/contracts/menu'
import * as v from 'valibot'
import { fromMinor, toMinor } from '~/utils/money'

/** Upper bound in dollars (the server's typo guard, `MAX_PRICE_MINOR`). */
export const MAX_PRICE = MAX_PRICE_MINOR / 100

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
  id: v.optional(v.string()),
  optionName: nameSchema('Option name'),
  price: priceSchema,
})

/**
 * The editor offers two switches: "required" (at least one choice) and "pick several" (no upper
 * limit); the API stores them as `minSelect` / `maxSelect`.
 */
const variantSchema = v.object({
  key: v.string(),
  id: v.optional(v.string()),
  variantName: nameSchema('Group name'),
  requiredSelection: v.boolean(),
  allowMultipleSelection: v.boolean(),
  options: v.pipe(v.array(optionSchema), v.minLength(1, 'Add at least one option')),
})

/** Form rules, with user-facing messages (the server checks the same limits). */
export const productFormSchema = v.object({
  name: nameSchema('Name'),
  categoryId: v.pipe(v.optional(v.string()), v.check(id => id !== undefined, 'Category is required')),
  /** Dollars; sent as cents. */
  price: priceSchema,
  description: v.pipe(v.string(), v.trim(), v.maxLength(500, 'Max 500 characters')),
  scheduleIds: v.array(v.string()),
  status: v.picklist(['ACTIVE', 'INACTIVE']),
  imageUrl: v.optional(v.string()),
  imageAssetId: v.optional(v.string()),
  variants: v.array(variantSchema),
})

export type ProductForm = v.InferOutput<typeof productFormSchema>
export type VariantForm = ProductForm['variants'][number]
export type VariantOptionForm = VariantForm['options'][number]

let newKeys = 0
const newKey = (kind: string) => `${kind}:new:${++newKeys}`

/** An empty option row: free by default (most options cost nothing extra). */
export function newOption(): VariantOptionForm {
  return { key: newKey('option'), id: undefined, optionName: '', price: 0 }
}

/** An empty group with one option, "pick one" and optional by default. */
export function newVariant(): VariantForm {
  return { key: newKey('variant'), id: undefined, variantName: '', requiredSelection: false, allowMultipleSelection: false, options: [newOption()] }
}

function toVariantForm(group: VariantGroup): VariantForm {
  return {
    key: `variant:${group.id}`,
    id: group.id,
    variantName: group.name,
    requiredSelection: group.minSelect >= 1,
    allowMultipleSelection: group.maxSelect !== 1,
    options: group.options.map(option => ({
      key: `option:${option.id}`,
      id: option.id,
      optionName: option.name,
      price: fromMinor(option.priceDeltaMinor),
    })),
  }
}

/** Initial form state, from an existing menu item or defaults for a new one. */
export function toProductForm(product?: Product): ProductForm {
  return {
    name: product?.name ?? '',
    categoryId: product?.category.id,
    price: product ? fromMinor(product.priceMinor) : undefined,
    description: product?.description ?? '',
    scheduleIds: [...(product?.scheduleIds ?? [])],
    status: product?.status ?? 'ACTIVE',
    imageUrl: product?.image?.url,
    imageAssetId: product?.image?.id,
    variants: (product?.variantGroups ?? []).map(toVariantForm),
  }
}

/**
 * The variants as edited: the **complete** list in the order shown. Kept groups and options carry
 * their ids, new ones have none, and removed ones are left out (the API deletes them).
 * A group's min/max are kept as stored while its two switches are unchanged, so a limit the form
 * can't show (e.g. "pick 2") isn't lost by saving.
 */
function toVariantGroupsInput(variants: VariantForm[], existing?: Product): VariantGroupInput[] {
  return variants.map((variant) => {
    const before = variant.id === undefined ? undefined : existing?.variantGroups.find(g => g.id === variant.id)
    const unchanged = before
      && variant.requiredSelection === (before.minSelect >= 1)
      && variant.allowMultipleSelection === (before.maxSelect !== 1)
    return {
      ...(variant.id === undefined ? {} : { id: variant.id }),
      name: variant.variantName,
      minSelect: unchanged ? before.minSelect : variant.requiredSelection ? 1 : 0,
      maxSelect: unchanged ? before.maxSelect : variant.allowMultipleSelection ? null : 1,
      options: variant.options.map(option => ({
        ...(option.id === undefined ? {} : { id: option.id }),
        name: option.optionName,
        priceDeltaMinor: toMinor(option.price ?? 0),
      })),
    }
  })
}

function fieldsOf(form: ProductForm, existing?: Product) {
  return {
    name: form.name,
    description: form.description,
    categoryId: form.categoryId!,
    priceMinor: toMinor(form.price ?? 0),
    imageAssetId: form.imageAssetId ?? null,
    status: form.status,
    scheduleIds: [...form.scheduleIds],
    variantGroups: toVariantGroupsInput(form.variants, existing),
  }
}

/** Create body. Call with a validated form (category and price are set). */
export function toCreateProductBody(form: ProductForm): CreateProductBody {
  return fieldsOf(form)
}

/**
 * Update body: every field the form edits, from the version it was opened with. Variants and
 * schedules are the full lists (the API replaces them); no image is `null` (clears it).
 */
export function toUpdateProductBody(form: ProductForm, existing: Product): UpdateProductBody {
  return { version: existing.version, ...fieldsOf(form, existing) }
}
