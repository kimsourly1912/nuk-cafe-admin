import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { optionSetFormSchema, toCreateOptionSetBody, toOptionSetForm, valueNameSchema } from '../schemas/option-set-form'

const issues = (form: unknown) => v.safeParse(optionSetFormSchema, form).issues?.map(i => [v.getDotPath(i), i.message]) ?? []

describe('new option set form', () => {
  it('starts with a name and two empty values', () => {
    expect(toOptionSetForm()).toEqual({ name: '', values: ['', ''] })
  })

  it('needs a name and every listed value', () => {
    expect(issues({ name: ' ', values: ['Small', ''] })).toEqual([['name', 'Name is required'], ['values.1', 'Value is required']])
    expect(issues({ name: 'Size', values: [] })).toEqual([['values', 'Add at least one value']])
  })

  it('refuses the same value twice, ignoring case and spaces', () => {
    expect(issues({ name: 'Size', values: ['Small', ' small '] })).toEqual([['values', 'Each value can be listed only once']])
  })

  it('refuses more than 20 values and names over 40 characters', () => {
    expect(issues({ name: 'Size', values: Array.from({ length: 21 }, (_, i) => `V${i}`) })).toEqual([['values', 'At most 20 values']])
    expect(v.safeParse(valueNameSchema, 'x'.repeat(41)).issues?.[0]?.message).toBe('Max 40 characters')
  })

  it('sends the names trimmed, in the order typed', () => {
    expect(toCreateOptionSetBody({ name: ' Size ', values: [' Small', 'Large '] })).toEqual({ name: 'Size', values: ['Small', 'Large'] })
  })
})
