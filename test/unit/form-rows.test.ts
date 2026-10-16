import { describe, expect, it } from 'vitest'
import { followRowErrors } from '~/utils/form-rows'

const moved = (from: number, to: number, length: number) => {
  const order = Array.from({ length }, (_, i) => i)
  const [row] = order.splice(from, 1)
  order.splice(to, 0, row!)
  return order
}

describe('followRowErrors', () => {
  it('drops the error of a removed row and moves the rows after it up', () => {
    const errors = [{ name: 'values.1', message: 'Value is required' }, { name: 'values.2', message: 'Value is required' }]
    // Row 1 is removed: its error goes, and row 2's error moves up to row 1 (not left on it).
    expect(followRowErrors(errors, 'values', [0, 2])).toEqual([{ name: 'values.1', message: 'Value is required' }])
  })

  it('moves an error with its row when the row moves', () => {
    expect(followRowErrors([{ name: 'values.0', message: 'Value is required' }], 'values', moved(0, 2, 3)))
      .toEqual([{ name: 'values.2', message: 'Value is required' }])
  })

  it('keeps the sub-field of a row error (modifiers.N.price)', () => {
    const errors = [{ name: 'modifiers.2.price', message: 'At most $50' }]
    expect(followRowErrors(errors, 'modifiers', [0, 1])).toEqual([])
    expect(followRowErrors(errors, 'modifiers', [0, 2, 1])).toEqual([{ name: 'modifiers.1.price', message: 'At most $50' }])
  })

  it('leaves other fields alone, and does not match a longer field name', () => {
    const other = [{ name: 'name', message: 'Name is required' }, { name: 'values', message: 'Each value can be listed only once' }, { name: 'valuesExtra.1', message: 'x' }]
    expect(followRowErrors(other, 'values', [0, 1, 2])).toEqual(other)
  })
})
