import type { CreateModifierGroupInput } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIER_PRICE_MINOR, MAX_MODIFIERS, MODIFIER_GROUP_NAME_MAX, MODIFIER_NAME_MAX, selectionProblem } from '#shared/contracts/menu-modifiers'
import * as v from 'valibot'
import { formatMinor, fromMinor, toMinor } from '~/utils/money'

/**
 * The new-group form and the rule wording. Prices are dollars in the form and cents in the API;
 * the selection rules are the server's own check (`selectionProblem`, shared contract), so the
 * form refuses what the server would, with the same message.
 */

const MAX_PRICE = fromMinor(MAX_MODIFIER_PRICE_MINOR)

export const nameRules = (label: string, max: number) =>
  v.pipe(v.string(), v.trim(), v.minLength(1, `${label} is required`), v.maxLength(max, `Max ${max} characters`))

export const groupNameSchema = nameRules('Name', MODIFIER_GROUP_NAME_MAX)
export const addOnNameSchema = nameRules('Add-on name', MODIFIER_NAME_MAX)
/** Dollars; empty means free. */
export const priceSchema = v.optional(v.pipe(v.number(), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_PRICE, `At most $${MAX_PRICE}`)))

export interface AddOnRow {
  name: string
  /** Dollars; `undefined` = free. */
  price?: number
  isDefault: boolean
}

export interface ModifierGroupForm {
  name: string
  minSelect: number
  /** `null`: no limit. */
  maxSelect: number | null
  modifiers: AddOnRow[]
}

export const modifierGroupFormSchema = v.pipe(
  v.object({
    name: groupNameSchema,
    minSelect: v.pipe(v.number('Enter a number'), v.integer(), v.minValue(0, 'Can\'t be negative'), v.maxValue(MAX_MODIFIERS)),
    maxSelect: v.nullable(v.pipe(v.number('Enter a number'), v.integer(), v.minValue(1, 'At least 1'), v.maxValue(MAX_MODIFIERS))),
    modifiers: v.pipe(
      v.array(v.object({ name: addOnNameSchema, price: priceSchema, isDefault: v.boolean() })),
      v.minLength(1, 'Add at least one add-on'),
      v.maxLength(MAX_MODIFIERS, `At most ${MAX_MODIFIERS} add-ons`),
      v.check(list => new Set(list.map(m => m.name.trim().toLowerCase())).size === list.length, 'Each add-on can be listed only once'),
    ),
  }),
  // The server's rule, with its message, on the field it names.
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return
    const { minSelect, maxSelect, modifiers } = dataset.value
    const problem = selectionProblem({ minSelect, maxSelect, active: modifiers.length, defaults: modifiers.filter(m => m.isDefault).length })
    if (problem) addIssue({ message: problem.message, path: [{ type: 'object', origin: 'value', input: dataset.value, key: problem.field, value: dataset.value[problem.field as keyof typeof dataset.value] }] })
  }),
)

/** A new group: optional, any number, two empty add-ons. */
export const toModifierGroupForm = (): ModifierGroupForm => ({
  name: '',
  minSelect: 0,
  maxSelect: null,
  modifiers: [{ name: '', price: undefined, isDefault: false }, { name: '', price: undefined, isDefault: false }],
})

export function toCreateModifierGroupBody(form: ModifierGroupForm): CreateModifierGroupInput {
  return {
    name: form.name.trim(),
    minSelect: form.minSelect,
    maxSelect: form.maxSelect,
    modifiers: form.modifiers.map(m => ({ name: m.name.trim(), priceDeltaMinor: toMinor(m.price ?? 0), isDefault: m.isDefault })),
  }
}

/** The rules in words: "Optional · up to 2", "Required · choose 1", "Required · 1 to 3". */
export function describeRules(minSelect: number, maxSelect: number | null): string {
  if (minSelect === 0) return maxSelect === null ? 'Optional · any number' : `Optional · up to ${maxSelect}`
  if (maxSelect === null) return `Required · at least ${minSelect}`
  if (maxSelect === minSelect) return `Required · choose ${minSelect}`
  return `Required · ${minSelect} to ${maxSelect}`
}

/** `50` → `"+$0.50"`, `0` → `"Free"`. */
export const formatDelta = (priceMinor: number) => (priceMinor ? `+${formatMinor(priceMinor)}` : 'Free')
