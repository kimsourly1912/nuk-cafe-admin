import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { CafeSettings } from '#shared/contracts/cafe'
import { CAFE_NAME_MAX } from '#shared/contracts/cafe'
import { cafeFormSchema, toCafeForm, toUpdateCafeBody } from '../schemas/cafe-form'

const settings = (overrides: Partial<CafeSettings> = {}): CafeSettings => ({
  slug: 'nuk',
  name: 'NUK Cafe',
  logoUrl: '/media/logo.webp',
  logoAssetId: 'asset-1',
  status: 'active',
  version: 3,
  ...overrides,
})
const errorsOf = (form: unknown) => (v.safeParse(cafeFormSchema, form).issues ?? []).map(issue => `${v.getDotPath(issue)}: ${issue.message}`)

describe('cafe form', () => {
  it('starts from the saved profile and saves at its version', () => {
    const form = toCafeForm(settings())
    expect(form).toEqual({ name: 'NUK Cafe', logoUrl: '/media/logo.webp', logoId: 'asset-1' })
    expect(toUpdateCafeBody({ ...form, name: '  Brown Bean  ' }, 3)).toEqual({ version: 3, name: 'Brown Bean', logoAssetId: 'asset-1' })
  })

  it('sends no logo as null', () => {
    const form = toCafeForm(settings({ logoUrl: null, logoAssetId: null }))
    expect(form).toEqual({ name: 'NUK Cafe', logoUrl: undefined, logoId: undefined })
    expect(toUpdateCafeBody(form, 1).logoAssetId).toBeNull()
  })

  it('needs a name, at most the server\'s length', () => {
    expect(errorsOf({ name: '   ' })).toEqual(['name: Cafe name is required'])
    expect(errorsOf({ name: 'x'.repeat(CAFE_NAME_MAX + 1) })).toEqual([`name: At most ${CAFE_NAME_MAX} characters`])
    expect(errorsOf({ name: 'x'.repeat(CAFE_NAME_MAX) })).toEqual([])
  })
})
