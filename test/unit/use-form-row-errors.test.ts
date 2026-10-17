import { describe, expect, it } from 'vitest'
import { useFormRowErrors } from '~/composables/useFormRowErrors'

type Err = { name?: string, message: string }

/** A stand-in for a `UForm` template ref: its errors, read and set as `UForm` does. */
function stubForm(initial: Err[]) {
  let errors = initial
  return {
    getErrors: () => errors,
    setErrors: (next: Err[]) => {
      errors = next
    },
    errors: () => errors,
  }
}

describe('useFormRowErrors', () => {
  it('removing a row removes its error and moves the later rows\' errors up', () => {
    const form = stubForm([{ name: 'values.1', message: 'Value is required' }, { name: 'values.2', message: 'Value is required' }])
    const list = ['a', '', '']
    useFormRowErrors(form, 'values').removeRow(list, 1)
    expect(list).toEqual(['a', ''])
    expect(form.errors()).toEqual([{ name: 'values.1', message: 'Value is required' }])
  })

  it('moving a row moves its error with it, and keeps the others in place', () => {
    const form = stubForm([{ name: 'modifiers.0.price', message: 'At most $50' }, { name: 'name', message: 'Name is required' }])
    const list = ['first', 'second', 'third']
    useFormRowErrors(form, 'modifiers').moveRow(list, 0, 2)
    expect(list).toEqual(['second', 'third', 'first'])
    expect(form.errors()).toEqual([{ name: 'modifiers.2.price', message: 'At most $50' }, { name: 'name', message: 'Name is required' }])
  })

  it('a move past either end changes nothing', () => {
    const errors = [{ name: 'values.0', message: 'Value is required' }]
    const form = stubForm(errors)
    const list = ['a', 'b']
    useFormRowErrors(form, 'values').moveRow(list, 0, -1)
    useFormRowErrors(form, 'values').moveRow(list, 1, 2)
    expect(list).toEqual(['a', 'b'])
    expect(form.errors()).toEqual(errors)
  })

  it('works before the form is mounted (no ref yet)', () => {
    const list = ['a', 'b']
    const rows = useFormRowErrors(null, 'values')
    rows.removeRow(list, 0)
    expect(list).toEqual(['b'])
  })
})
