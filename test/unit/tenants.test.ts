import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS, slugFromName, slugSchema } from '#shared/contracts/tenants'

// A cafe's web address, `/c/<slug>` (D142): the same rules on the form and the server.

const check = (slug: string) => {
  const result = v.safeParse(slugSchema, slug)
  return result.success ? result.output : result.issues[0].message
}

describe('a cafe\'s address', () => {
  it('takes lowercase letters, numbers and single dashes, trimmed and lowercased', () => {
    expect(check('brown-bean')).toBe('brown-bean')
    expect(check('  Brown-Bean2 ')).toBe('brown-bean2')
    expect(check('abc')).toBe('abc')
    expect(check('a'.repeat(40))).toBe('a'.repeat(40))
  })

  it('refuses other characters, dashes at the ends or doubled, and lengths outside 3–40', () => {
    for (const slug of ['brown bean', 'brown_bean', 'café', '-brown', 'brown-', 'brown--bean', 'ab', 'a'.repeat(41), 'brown/bean']) {
      expect(check(slug), slug).not.toBe(slug.trim().toLowerCase())
    }
  })

  it('refuses the platform\'s reserved addresses', () => {
    for (const slug of ['admin', 'api', 'platform', 'www', 'sign-in', 'table']) {
      expect(RESERVED_SLUGS.has(slug)).toBe(true)
      expect(check(slug)).toBe('This address is reserved')
    }
  })

  it('is suggested from the cafe\'s name', () => {
    expect(slugFromName('Brown Bean Café')).toBe('brown-bean-cafe')
    expect(slugFromName('  NUK  Cafe & Bakery!! ')).toBe('nuk-cafe-bakery')
    expect(slugFromName('ហាងកាហ្វេ')).toBe('')
    expect(slugFromName(`${'a'.repeat(39)} bcd`)).toBe('a'.repeat(39))
  })
})
