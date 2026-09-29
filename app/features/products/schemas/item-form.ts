import type { CreateItemInput, ItemModifierGroup, ItemOptionSet, MenuItem, UpdateItemInput } from '#shared/contracts/menu-items'
import { ITEM_DESCRIPTION_MAX, ITEM_NAME_MAX, MAX_VARIATION_PRICE_MINOR } from '#shared/contracts/menu-items'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIER_PRICE_MINOR, MAX_MODIFIERS, selectionProblem } from '#shared/contracts/menu-modifiers'
import type { OptionSet } from '#shared/contracts/menu-options'
import * as v from 'valibot'
import { fromMinor, toMinor } from '~/utils/money'

/**
 * The menu-item form (D70): the item, its option sets and price grid, its add-on groups with this
 * item's own rules and prices, and its availability rules. The API saves all of it under one
 * `version`, so the form sends it all at once. Prices are dollars here and cents in the API.
 */

/** An option set as the form uses it: the grid's rows (first set) and columns (second set). */
export interface FormOptionSet {
  id: string
  name: string
  status: 'active' | 'archived'
  /** Active values in order: only these make grid cells (the server's rule, D60). */
  values: { id: string, name: string }[]
}

/** One version of the item: a combination of values, its price and whether it's sold. */
export interface GridCell {
  /** The combination's identity, like the server's: value ids sorted and joined. */
  key: string
  /** In option-set order. */
  valueIds: string[]
  /** "Large, Iced"; `''` without option sets. */
  label: string
  /** Dollars; `undefined` = no price yet. */
  price?: number
  on: boolean
}

export interface FormAddOn {
  id: string
  name: string
  status: 'active' | 'archived'
  isDefault: boolean
  /** The library's price, in cents. */
  defaultPriceMinor: number
  /** Dollars. Different from the library's price = this item's own price. */
  price?: number
}

export interface FormAddOnGroup {
  id: string
  name: string
  status: 'active' | 'archived'
  /** The library's rules, shown when the item doesn't use its own. */
  groupMinSelect: number
  groupMaxSelect: number | null
  ownRules: boolean
  minSelect: number
  /** `null`: no limit. */
  maxSelect: number | null
  addOns: FormAddOn[]
}

export interface ItemForm {
  name: string
  description: string
  categoryId?: string
  imageId?: string
  imageUrl?: string
  optionSets: FormOptionSet[]
  grid: GridCell[]
  addOnGroups: FormAddOnGroup[]
  availabilityRuleIds: string[]
}

/** Like the server's `combinationKey`: order-independent. */
export const combinationKey = (valueIds: readonly string[]) => [...valueIds].sort().join(',')

/**
 * The grid for these option sets: every combination of their active values (the first set
 * varies slowest, like the server). A cell keeps its price and switch from `previous` when the
 * same combination was there; a new one starts without a price, `on` as given.
 */
export function buildGrid(sets: readonly FormOptionSet[], previous: readonly GridCell[], on: boolean): GridCell[] {
  const kept = new Map(previous.map(cell => [cell.key, cell]))
  const combinations = sets.reduce<{ id: string, name: string }[][]>((rows, set) => rows.flatMap(row => set.values.map(value => [...row, value])), [[]])
  return combinations.map((values) => {
    const valueIds = values.map(value => value.id)
    const key = combinationKey(valueIds)
    const before = kept.get(key)
    return { key, valueIds, label: values.map(value => value.name).join(', '), price: before?.price, on: before ? before.on : on }
  })
}

const toFormSet = (set: ItemOptionSet | OptionSet): FormOptionSet => ({
  id: set.id,
  name: set.name,
  status: set.status,
  values: set.values.filter(value => value.status === 'active').map(value => ({ id: value.id, name: value.name })),
})

/** An option set chosen from the library. */
export const optionSetFromLibrary = (set: OptionSet) => toFormSet(set)

function toFormGroup(group: ItemModifierGroup, library?: ModifierGroup): FormAddOnGroup {
  return {
    id: group.id,
    name: group.name,
    status: group.status,
    // The item shows the rules that apply; with its own rules, the library's come from the library.
    groupMinSelect: group.rulesOverridden ? (library?.minSelect ?? group.minSelect) : group.minSelect,
    groupMaxSelect: group.rulesOverridden ? (library ? library.maxSelect : group.maxSelect) : group.maxSelect,
    ownRules: group.rulesOverridden,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    addOns: group.modifiers.map(modifier => ({
      id: modifier.id,
      name: modifier.name,
      status: modifier.status,
      isDefault: modifier.isDefault,
      defaultPriceMinor: modifier.defaultPriceDeltaMinor,
      price: fromMinor(modifier.priceDeltaMinor),
    })),
  }
}

/** An add-on group chosen from the library: its rules and prices, its active add-ons. */
export function addOnGroupFromLibrary(group: ModifierGroup): FormAddOnGroup {
  return {
    id: group.id,
    name: group.name,
    status: group.status,
    groupMinSelect: group.minSelect,
    groupMaxSelect: group.maxSelect,
    ownRules: false,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    addOns: group.modifiers.filter(m => m.status === 'active').map(m => ({
      id: m.id,
      name: m.name,
      status: m.status,
      isDefault: m.isDefault,
      defaultPriceMinor: m.priceDeltaMinor,
      price: fromMinor(m.priceDeltaMinor),
    })),
  }
}

/**
 * The form for an item, or a new one (one version, sold, no price yet). An existing item's grid is
 * rebuilt from its option sets' active values; a combination it doesn't have yet (a value added
 * to the set later) starts switched off, so saving doesn't sell it by surprise. Versions hidden by
 * an archived value aren't in the grid: the server keeps them as they are.
 */
export function toItemForm(item?: MenuItem, library: readonly ModifierGroup[] = []): ItemForm {
  if (!item) {
    return { name: '', description: '', categoryId: undefined, imageId: undefined, imageUrl: undefined, optionSets: [], grid: buildGrid([], [], true), addOnGroups: [], availabilityRuleIds: [] }
  }
  const optionSets = item.optionSets.map(toFormSet)
  const cells = item.variations.map(variation => ({
    key: combinationKey(variation.valueIds),
    valueIds: variation.valueIds,
    label: variation.label,
    price: variation.priceMinor === null ? undefined : fromMinor(variation.priceMinor),
    on: variation.status === 'active',
  }))
  return {
    name: item.name,
    description: item.description,
    categoryId: item.categoryId,
    imageId: item.image?.id,
    imageUrl: item.image?.url,
    optionSets,
    grid: buildGrid(optionSets, cells, false),
    addOnGroups: item.modifierGroups.map(group => toFormGroup(group, library.find(g => g.id === group.id))),
    availabilityRuleIds: item.availabilityRules.map(rule => rule.id),
  }
}

// --- Rules (the server checks the same; these give the message before sending) ---

const MAX_PRICE = fromMinor(MAX_VARIATION_PRICE_MINOR)
const MAX_ADD_ON_PRICE = fromMinor(MAX_MODIFIER_PRICE_MINOR)

const cellSchema = v.pipe(
  v.object({
    key: v.string(),
    valueIds: v.array(v.string()),
    label: v.string(),
    price: v.optional(v.pipe(v.number(), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_PRICE, `At most $${MAX_PRICE.toLocaleString('en-US')}`))),
    on: v.boolean(),
  }),
  v.forward(v.check(cell => !cell.on || cell.price !== undefined, 'Set a price, or switch it off'), ['price']),
)

const addOnGroupSchema = v.pipe(
  v.object({
    id: v.string(),
    name: v.string(),
    status: v.picklist(['active', 'archived']),
    groupMinSelect: v.number(),
    groupMaxSelect: v.nullable(v.number()),
    ownRules: v.boolean(),
    minSelect: v.pipe(v.number('Enter a number'), v.integer(), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_MODIFIERS)),
    maxSelect: v.nullable(v.pipe(v.number('Enter a number'), v.integer(), v.minValue(1, 'At least 1'), v.maxValue(MAX_MODIFIERS))),
    addOns: v.array(v.object({
      id: v.string(),
      name: v.string(),
      status: v.picklist(['active', 'archived']),
      isDefault: v.boolean(),
      defaultPriceMinor: v.number(),
      price: v.optional(v.pipe(v.number(), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_ADD_ON_PRICE, `At most $${MAX_ADD_ON_PRICE}`))),
    })),
  }),
  // The item's own rules must be possible with the group's active add-ons (the server's check).
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed || !dataset.value.ownRules) return
    const problem = ownRulesProblem(dataset.value)
    if (!problem) return
    const key = problem.field === 'maxSelect' ? 'maxSelect' : 'minSelect'
    addIssue({ message: problem.message, path: [{ type: 'object', origin: 'value', input: dataset.value, key, value: dataset.value[key] }] })
  }),
)

/** Why this item's own rules for a group can't be met, like the server says it. */
export function ownRulesProblem(group: Pick<FormAddOnGroup, 'minSelect' | 'maxSelect' | 'addOns'>) {
  const active = group.addOns.filter(a => a.status === 'active')
  return selectionProblem({ minSelect: group.minSelect, maxSelect: group.maxSelect, active: active.length, defaults: active.filter(a => a.isDefault).length })
}

export const itemFormSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(ITEM_NAME_MAX, `Max ${ITEM_NAME_MAX} characters`)),
  description: v.pipe(v.string(), v.trim(), v.maxLength(ITEM_DESCRIPTION_MAX, `Max ${ITEM_DESCRIPTION_MAX} characters`)),
  categoryId: v.pipe(v.optional(v.string()), v.check(id => id !== undefined, 'Category is required')),
  imageId: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  optionSets: v.array(v.custom<FormOptionSet>(() => true)),
  grid: v.pipe(v.array(cellSchema), v.check(cells => cells.some(cell => cell.on), 'Switch on at least one version')),
  addOnGroups: v.array(addOnGroupSchema),
  availabilityRuleIds: v.array(v.string()),
})

// --- Requests ---

/**
 * The add-on groups as the API takes them. An add-on whose price differs from the library's is
 * this item's own price; one equal to it follows the library (a later library change applies).
 */
function toModifierGroupsInput(groups: readonly FormAddOnGroup[]) {
  return groups.map(group => ({
    groupId: group.id,
    rules: group.ownRules ? { minSelect: group.minSelect, maxSelect: group.maxSelect } : null,
    prices: group.addOns.flatMap((addOn) => {
      const priceMinor = toMinor(addOn.price ?? 0)
      return priceMinor === addOn.defaultPriceMinor ? [] : [{ modifierId: addOn.id, priceDeltaMinor: priceMinor }]
    }),
  }))
}

function fieldsOf(form: ItemForm) {
  return {
    categoryId: form.categoryId!,
    name: form.name.trim(),
    description: form.description.trim(),
    imageId: form.imageId ?? null,
    optionSetIds: form.optionSets.map(set => set.id),
    variations: form.grid.map(cell => ({
      valueIds: cell.valueIds,
      priceMinor: cell.price === undefined ? null : toMinor(cell.price),
      status: cell.on ? 'active' as const : 'disabled' as const,
    })),
    modifierGroups: toModifierGroupsInput(form.addOnGroups),
    availabilityRuleIds: [...form.availabilityRuleIds],
  }
}

/** Create body (a draft). Call with a validated form. */
export function toCreateItemBody(form: ItemForm): CreateItemInput {
  return fieldsOf(form)
}

/**
 * Update body: everything, from the version the form opened. The API accepts back what it sent
 * (an archived option set, add-on group or rule already on the item stays); no image is `null`.
 */
export function toUpdateItemBody(form: ItemForm, item: MenuItem): UpdateItemInput {
  return { version: item.version, ...fieldsOf(form) }
}

// --- Errors and sections ---

/** A server field name as the form names it, so a refused field shows its message where it's edited. */
export function formFieldOf(serverField: string): string {
  return serverField
    .replace(/^variations\.(\d+)\.priceMinor$/, 'grid.$1.price')
    .replace(/^variations$/, 'grid')
    .replace(/^modifierGroups\.(\d+)\.rules\.(minSelect|maxSelect)$/, 'addOnGroups.$1.$2')
}

/** The editor's sections: on phones the route shows one at a time (D90). */
export const ITEM_FORM_SECTIONS = [
  { value: 'details', label: 'Details' },
  { value: 'prices', label: 'Prices' },
  { value: 'add-ons', label: 'Add-ons' },
  { value: 'availability', label: 'Availability' },
] as const
export type ItemFormSection = typeof ITEM_FORM_SECTIONS[number]['value']

/** The section a form field is edited in, so an error in a hidden section can be shown. */
export function sectionOf(field: string): ItemFormSection {
  const root = field.split('.')[0]
  if (root === 'optionSets' || root === 'grid') return 'prices'
  if (root === 'addOnGroups') return 'add-ons'
  if (root === 'availabilityRuleIds') return 'availability'
  return 'details'
}
