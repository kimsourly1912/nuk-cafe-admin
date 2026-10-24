import { describe, expect, it } from 'vitest'
import { webManifestPath } from '#shared/contracts/cafe'
import { webManifest } from '#server/features/tenants'

const brown = { slug: 'brown-bean', name: 'Brown Bean', logoUrl: '/media/t/x/menu/logo.webp', status: 'active' as const }

describe('a cafe\'s installable app (D202)', () => {
  it('is the counter or the admin of this cafe, by its name', () => {
    expect(webManifest(brown, 'counter')).toMatchObject({ id: '/c/brown-bean/counter', name: 'Brown Bean Counter', short_name: 'Counter', start_url: '/c/brown-bean/counter', scope: '/', display: 'standalone' })
    expect(webManifest(brown, 'admin')).toMatchObject({ id: '/c/brown-bean/admin', name: 'Brown Bean Admin', short_name: 'Admin', start_url: '/c/brown-bean/admin' })
  })

  it('has the icons browsers install from: 192 and 512, and a maskable 512', () => {
    expect(webManifest(brown, 'counter').icons.map(icon => [icon.sizes, icon.purpose])).toEqual([['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']])
  })

  it('carries nothing but the cafe\'s public name and address', () => {
    const text = JSON.stringify(webManifest(brown, 'admin'))
    expect(text).not.toContain('logo.webp')
    expect(text).not.toContain('tenant')
  })

  it('is linked where the route serves it', () => {
    expect(webManifestPath('brown-bean', 'counter')).toBe('/c/brown-bean/counter.webmanifest')
    expect(webManifestPath('brown-bean', 'admin')).toBe('/c/brown-bean/admin.webmanifest')
  })
})
