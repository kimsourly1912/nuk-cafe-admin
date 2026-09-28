import { describe, expect, it } from 'vitest'
import { formatMinor, formatPrice, roundPrice, toMinor } from '../../app/utils/money'

describe('money', () => {
  it('formats US dollars with cents', () => {
    expect(formatPrice(6.2)).toBe('$6.20')
    expect(formatPrice(1234.5)).toBe('$1,234.50')
    expect(formatPrice(0)).toBe('$0.00')
    expect(formatPrice(undefined)).toBe('—')
    expect(formatMinor(620)).toBe('$6.20')
  })

  it('rounds prices to whole cents', () => {
    expect(toMinor(6.225)).toBe(623)
    // 1.005 * 100 is 100.4999… in floating point: a naive round gives 100.
    expect(toMinor(1.005)).toBe(101)
    expect(toMinor(1.004)).toBe(100)
    expect(toMinor(0.1 + 0.2)).toBe(30)
    expect(roundPrice(16.99)).toBe(16.99)
  })
})
