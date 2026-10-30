import { describe, expect, it } from 'vitest'
import type { AccountCafe } from '#shared/contracts/cafe'
import { otherAccess, otherCafes, workspaceUrl } from '~/utils/account-cafes'

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

describe('a refused sign-in (D239)', () => {
  it('names this cafe\'s other workspace and whether another cafe opens; nothing for an account that works nowhere', () => {
    // A manager at the admin sign-in: this cafe's counter.
    expect(otherAccess([cafe('nuk', { workspaces: ['counter'] })], 'nuk', 'admin')).toEqual({ here: 'counter', elsewhere: false, platform: false })
    // Another cafe's owner or staff: Your cafes, whatever the workspace there.
    expect(otherAccess([cafe('brown-bean')], 'nuk', 'admin')).toEqual({ here: null, elsewhere: true, platform: false })
    expect(otherAccess([cafe('brown-bean', { workspaces: ['counter'] })], 'nuk', 'counter')).toEqual({ here: null, elsewhere: true, platform: false })
    expect(otherAccess([cafe('nuk', { workspaces: ['counter'] }), cafe('brown-bean')], 'nuk', 'admin')).toEqual({ here: 'counter', elsewhere: true, platform: false })
    // A platform team account with no cafe: the console.
    expect(otherAccess([], 'nuk', 'admin', true)).toEqual({ here: null, elsewhere: false, platform: true })
    // A customer, or only paused cafes: nothing, so the sign-in signs out again.
    expect(otherAccess([], 'nuk', 'admin')).toBeNull()
    expect(otherAccess([cafe('nuk', { workspaces: ['counter'], status: 'suspended' }), cafe('quiet-corner', { status: 'suspended' })], 'nuk', 'admin')).toBeNull()
  })

  it('at the platform console (no cafe): Your cafes for a cafe\'s staff, nothing for a customer (D241)', () => {
    expect(otherAccess([cafe('nuk', { workspaces: ['counter'] })], '', 'console')).toEqual({ here: null, elsewhere: true, platform: false })
    expect(otherAccess([cafe('nuk', { status: 'suspended' })], '', 'console')).toBeNull()
    expect(otherAccess([], '', 'console')).toBeNull()
  })
})
