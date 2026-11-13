import { describe, expect, it } from 'vitest'
import { evaluateNumber } from '../designer/expression'

describe('a number typed in a Studio field (ISS-020)', () => {
  it('reads plain numbers and simple math, Figma-style', () => {
    expect(evaluateNumber('975')).toBe(975)
    expect(evaluateNumber(' 900 + 25 ')).toBe(925)
    expect(evaluateNumber('10+5')).toBe(15)
    expect(evaluateNumber('120*2')).toBe(240)
    expect(evaluateNumber('120x2')).toBe(240)
    expect(evaluateNumber('(600-40)/2')).toBe(280)
    expect(evaluateNumber('2+3*4')).toBe(14)
    expect(evaluateNumber('-15')).toBe(-15)
    expect(evaluateNumber('10--5')).toBe(15)
    expect(evaluateNumber('12,5')).toBe(12.5)
  })

  it('refuses anything else, and dividing by zero', () => {
    for (const text of ['', 'abc', '1e3', '5/0', '(1+2', '1+', '2**3', 'alert(1)', '..5']) expect(evaluateNumber(text)).toBeNull()
  })
})
