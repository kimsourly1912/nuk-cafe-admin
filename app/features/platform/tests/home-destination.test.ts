import { describe, expect, it } from 'vitest'
import type { AccountCafe } from '#shared/contracts/cafe'
import { homeDestination } from '../utils/home-destination'

const cafe = (slug: string, overrides: Partial<AccountCafe> = {}): AccountCafe => ({ slug, name: slug, logoUrl: null, status: 'active', workspaces: ['admin'], ...overrides })

describe('homeDestination', () => {
  it('opens the only workspace directly, as a full page load', () => {
    expect(homeDestination([cafe('nuk')], false)).toEqual({ label: 'Open admin', icon: 'i-lucide-layout-dashboard', to: '/c/nuk/admin', external: true, cafeName: 'nuk' })
    expect(homeDestination([cafe('nuk', { workspaces: ['counter'] })], false)).toMatchObject({ label: 'Open counter', to: '/c/nuk/counter' })
    // A paused cafe opens nothing, so the active one is still the only door.
    expect(homeDestination([cafe('nuk'), cafe('quiet-corner', { status: 'suspended' })], false)).toMatchObject({ to: '/c/nuk/admin' })
  })

  it('sends several workspaces, a paused cafe alone, or the team with a cafe to Your cafes', () => {
    const yourCafes = { label: 'Your cafes', icon: 'i-lucide-store', to: '/cafes', external: false }
    expect(homeDestination([cafe('nuk', { workspaces: ['admin', 'counter'] })], false)).toEqual(yourCafes)
    expect(homeDestination([cafe('nuk'), cafe('brown-bean', { workspaces: ['counter'] })], false)).toEqual(yourCafes)
    expect(homeDestination([cafe('nuk', { status: 'suspended' })], false)).toEqual(yourCafes)
    expect(homeDestination([cafe('nuk')], true)).toEqual(yourCafes)
  })

  it('sends the platform team without a cafe to the console, and a customer nowhere', () => {
    expect(homeDestination([], true)).toEqual({ label: 'Platform console', icon: 'i-lucide-layers', to: '/platform', external: true })
    expect(homeDestination([], false)).toBeNull()
  })
})
