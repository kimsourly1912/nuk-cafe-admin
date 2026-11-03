import { describe, expect, it } from 'vitest'
import { redactFailureEntry } from '../e2e/support/failure-redaction'

describe('recovery credentials in failure evidence', () => {
  it('redacts duplicate and encoded credentials while preserving the useful route', () => {
    const result = redactFailureEntry('https://example.test/reset-password?token=fake-one&token=fake%2Btwo&redirect=%2Fc%2Fnuk', '<script>fake-one fake+two fake%2Btwo</script>')
    expect(result.html).toBe('<script>[redacted] [redacted] [redacted]</script>')
    const address = new URL(result.address)
    expect(address.pathname).toBe('/reset-password')
    expect(address.searchParams.getAll('token')).toEqual(['[redacted]'])
    expect(address.searchParams.get('redirect')).toBe('/c/nuk')
  })
})
