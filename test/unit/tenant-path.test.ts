import { describe, expect, it } from 'vitest'
import { splitTenantUrl, tenantNavigation, tenantUrl } from '../../app/utils/tenant-path'

describe('cafe addresses (D141)', () => {
  it('keeps a cafe binding through account pages and reloads before entering a second cafe', () => {
    let bound = tenantNavigation(null, '/c/nuk').tenant
    expect(bound).toBe('nuk')
    for (const path of ['/sign-in', '/verify-email', '/cafes']) {
      const next = tenantNavigation(bound, path)
      expect(next).toEqual({ tenant: 'nuk', reload: false })
      bound = next.tenant
    }
    expect(tenantNavigation(bound, '/c/nuk/checkout')).toEqual({ tenant: 'nuk', reload: false })
    expect(tenantNavigation(bound, '/c/brown-bean/checkout')).toEqual({ tenant: 'nuk', reload: true })
    expect(tenantNavigation(null, '/c/brown-bean/checkout')).toEqual({ tenant: 'brown-bean', reload: false })
  })
  it('puts a page inside its cafe', () => {
    expect(tenantUrl('nuk', '/admin/products')).toBe('/c/nuk/admin/products')
    expect(tenantUrl('nuk', '/')).toBe('/c/nuk')
    expect(tenantUrl('brown-bean', '/orders/o1?x=1')).toBe('/c/brown-bean/orders/o1?x=1')
  })

  it('splits an address into its cafe and the page inside it', () => {
    expect(splitTenantUrl('/c/nuk/admin/products')).toEqual({ slug: 'nuk', path: '/admin/products' })
    expect(splitTenantUrl('/c/nuk')).toEqual({ slug: 'nuk', path: '/' })
    expect(splitTenantUrl('/c/nuk/')).toEqual({ slug: 'nuk', path: '/' })
    expect(splitTenantUrl('/c/nuk?table=1')).toEqual({ slug: 'nuk', path: '/?table=1' })
    expect(splitTenantUrl('/c/nuk/checkout?x=1')).toEqual({ slug: 'nuk', path: '/checkout?x=1' })
  })

  it('finds no cafe in the platform\'s pages', () => {
    expect(splitTenantUrl('/sign-in?redirect=/c/nuk')).toBeNull()
    expect(splitTenantUrl('/table/abc')).toBeNull()
    expect(splitTenantUrl('/cafe')).toBeNull()
    expect(splitTenantUrl('/c/')).toBeNull()
    expect(splitTenantUrl('//c/nuk')).toBeNull()
  })
})
