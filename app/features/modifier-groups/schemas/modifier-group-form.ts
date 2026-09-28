import type { CreateModifierGroupInput, Modifier, ModifierGroup, UpdateModifierGroupInput } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIER_PRICE_MINOR, MAX_MODIFIERS, MODIFIER_GROUP_NAME_MAX, MODIFIER_NAME_MAX, selectionProblem } from '#shared/contracts/menu-modifiers'
import * as v from 'valibot'
import { fromMinor, toMinor } from '~/utils/money'

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

// --- The group page's settings (name and rules), saved with one PATCH (D75) ---

export interface GroupSettingsForm {
  name: string
  /** Optional (min 0) or required (min ≥ 1). */
  required: boolean
  /** Used when required. */
  minSelect: number | null
  /** `null`: no limit. */
  maxSelect: number | null
}

export type SettingsIssues = Partial<Record<'name' | 'minSelect' | 'maxSelect', string>>

export function toSettingsForm(group: ModifierGroup): GroupSettingsForm {
  return { name: group.name, required: group.minSelect > 0, minSelect: group.minSelect > 0 ? group.minSelect : 1, maxSelect: group.maxSelect }
}

/** The minimum the settings mean: 0 when optional. */
const minOf = (form: GroupSettingsForm) => (form.required ? form.minSelect ?? 0 : 0)

const whole = (value: number | null) => value === null || Number.isInteger(value)

/**
 * What's wrong with the settings, by field, against the group's active and pre-selected add-ons.
 * The selection check is the server's own (`selectionProblem`), with its message.
 */
export function settingsIssues(form: GroupSettingsForm, context: { active: number, defaults: number }): SettingsIssues {
  const issues: SettingsIssues = {}
  const name = v.safeParse(groupNameSchema, form.name)
  if (!name.success) issues.name = name.issues[0].message
  if (form.required && (form.minSelect === null || form.minSelect < 1)) issues.minSelect = 'A required group needs at least 1'
  else if (!whole(form.minSelect)) issues.minSelect = 'Enter a whole number'
  if (form.maxSelect !== null && form.maxSelect < 1) issues.maxSelect = 'At least 1'
  else if (!whole(form.maxSelect)) issues.maxSelect = 'Enter a whole number'
  if (issues.minSelect || issues.maxSelect) return issues
  const problem = selectionProblem({ minSelect: minOf(form), maxSelect: form.maxSelect, ...context })
  if (problem) {
    const field = problem.field === 'minSelect' ? 'minSelect' : 'maxSelect'
    issues[field] = problem.message
  }
  return issues
}

/** Only what changed, for the PATCH (`undefined`: nothing to save). */
export function toSettingsChanges(form: GroupSettingsForm, group: ModifierGroup): Omit<UpdateModifierGroupInput, 'version'> | undefined {
  const changes: Omit<UpdateModifierGroupInput, 'version'> = {}
  const name = form.name.trim()
  if (name !== group.name) changes.name = name
  if (minOf(form) !== group.minSelect) changes.minSelect = minOf(form)
  if (form.maxSelect !== group.maxSelect) changes.maxSelect = form.maxSelect
  return Object.keys(changes).length ? changes : undefined
}

// --- One add-on (the Add / Edit add-on dialog) ---

export interface AddOnForm {
  name: string
  /** Dollars; `undefined` = free. */
  price?: number
  isDefault: boolean
}

export type AddOnIssues = Partial<Record<'name' | 'price' | 'isDefault', string>>

export function toAddOnForm(modifier?: Modifier): AddOnForm {
  return modifier
    ? { name: modifier.name, price: fromMinor(modifier.priceDeltaMinor), isDefault: modifier.isDefault }
    : { name: '', price: undefined, isDefault: false }
}

/**
 * What's wrong with an add-on before sending, by field: its name (unique among the group's active
 * add-ons, like the server's index), its price, and whether pre-selecting it still fits the group's
 * maximum (the server's `selectionProblem`).
 */
export function addOnIssues(form: AddOnForm, group: ModifierGroup, editing?: Modifier): AddOnIssues {
  const issues: AddOnIssues = {}
  const name = v.safeParse(addOnNameSchema, form.name)
  if (!name.success) issues.name = name.issues[0].message
  else if (group.modifiers.some(m => m.id !== editing?.id && m.status === 'active' && m.name.toLowerCase() === name.output.toLowerCase())) issues.name = 'Already used in this group'
  const price = v.safeParse(priceSchema, form.price)
  if (!price.success) issues.price = price.issues[0].message
  const others = group.modifiers.filter(m => m.status === 'active' && m.id !== editing?.id)
  const problem = selectionProblem({
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    active: others.length + 1,
    defaults: others.filter(m => m.isDefault).length + (form.isDefault ? 1 : 0),
  })
  if (problem && form.isDefault && problem.field === 'modifiers' && group.maxSelect !== null) issues.isDefault = problem.message
  return issues
}

export function toAddOnFields(form: AddOnForm) {
  return { name: form.name.trim(), priceDeltaMinor: toMinor(form.price ?? 0), isDefault: form.isDefault }
}

/**
 * Why this add-on can't be archived, or `undefined`: the group needs an active add-on, and enough of
 * them for its minimum.
 */
export function archiveAddOnProblem(group: ModifierGroup, modifier: Modifier): string | undefined {
  const rest = group.modifiers.filter(m => m.status === 'active' && m.id !== modifier.id)
  return selectionProblem({ minSelect: group.minSelect, maxSelect: group.maxSelect, active: rest.length, defaults: rest.filter(m => m.isDefault).length })?.message
}

/** Why this add-on can't be pre-selected (the group's maximum), or `undefined`. */
export function preselectProblem(group: ModifierGroup, modifier: Modifier): string | undefined {
  const active = group.modifiers.filter(m => m.status === 'active')
  const defaults = active.filter(m => m.isDefault && m.id !== modifier.id).length + 1
  return selectionProblem({ minSelect: group.minSelect, maxSelect: group.maxSelect, active: active.length, defaults })?.message
}
