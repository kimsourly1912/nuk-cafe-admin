import type { CreateOptionSetInput } from '#shared/contracts/menu-options'
import { MAX_OPTION_VALUES, OPTION_SET_NAME_MAX, OPTION_VALUE_NAME_MAX } from '#shared/contracts/menu-options'
import * as v from 'valibot'

/** A set or value name, with the messages the forms show (the server checks the same limits). */
export const nameRules = (label: string, max: number) =>
  v.pipe(v.string(), v.trim(), v.minLength(1, `${label} is required`), v.maxLength(max, `Max ${max} characters`))

export const setNameSchema = nameRules('Name', OPTION_SET_NAME_MAX)
export const valueNameSchema = nameRules('Value', OPTION_VALUE_NAME_MAX)

/** The new-set form: a name and its first values, in order. */
export interface OptionSetForm {
  name: string
  values: string[]
}

export const optionSetFormSchema = v.object({
  name: setNameSchema,
  values: v.pipe(
    v.array(valueNameSchema),
    v.minLength(1, 'Add at least one value'),
    v.maxLength(MAX_OPTION_VALUES, `At most ${MAX_OPTION_VALUES} values`),
    v.check(values => new Set(values.map(value => value.trim().toLowerCase())).size === values.length, 'Each value can be listed only once'),
  ),
})

/** A new set starts with two empty values ("Small", "Large" is the usual start). */
export const toOptionSetForm = (): OptionSetForm => ({ name: '', values: ['', ''] })

export function toCreateOptionSetBody(form: OptionSetForm): CreateOptionSetInput {
  return { name: form.name.trim(), values: form.values.map(value => value.trim()) }
}
