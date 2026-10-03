import { describe, expect, it } from 'vitest'
import type { AccountCafe } from '#shared/contracts/cafe'
import { otherCafes, workspaceUrl } from '~/utils/account-cafes'

const cafe = (slug: string, overrides: Partial<AccountCafe> = {}): AccountCafe => ({ slug, name: slug, logoUrl: null, status: 'active', workspaces: ['admin', 'counter'], ...overrides })

describe('switching cafes', () => {
  it('offers the other active cafes where the workspace opens', () => {
    const cafes = [cafe('nuk'), cafe('brown-bean', { workspaces: ['counter'] }), cafe('quiet-corner', { status: 'suspended' }), cafe('tea-house')]
    expect(otherCafes(cafes, 'nuk', 'admin').map(c => c.slug)).toEqual(['tea-house'])
    expect(otherCafes(cafes, 'nuk', 'counter').map(c => c.slug)).toEqual(['brown-bean', 'tea-house'])
    expect(otherCafes(null, 'nuk', 'admin')).toEqual([])
  })

  it('names each workspace\'s address in the cafe', () => {
    expect(workspaceUrl('brown-bean', 'admin')).toBe('/c/brown-bean/admin')
    expect(workspaceUrl('brown-bean', 'counter')).toBe('/c/brown-bean/counter')
  })
})
