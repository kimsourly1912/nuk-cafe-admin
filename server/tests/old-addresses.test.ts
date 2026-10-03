import { describe, expect, it } from 'vitest'
import { oldAddressTarget } from '#server/utils/old-addresses'

describe('addresses from before cafe addresses (D141)', () => {
  it('go to the default cafe\'s, with the query', () => {
    expect(oldAddressTarget('/', 'nuk')).toBe('/c/nuk')
    expect(oldAddressTarget('/?branch=b1', 'nuk')).toBe('/c/nuk?branch=b1')
    expect(oldAddressTarget('/admin', 'nuk')).toBe('/c/nuk/admin')
    expect(oldAddressTarget('/admin/products?item=i1', 'nuk')).toBe('/c/nuk/admin/products?item=i1')
    expect(oldAddressTarget('/counter/b1?order=o1', 'nuk')).toBe('/c/nuk/counter/b1?order=o1')
    expect(oldAddressTarget('/checkout', 'nuk')).toBe('/c/nuk/checkout')
    expect(oldAddressTarget('/orders', 'nuk')).toBe('/c/nuk/orders')
    expect(oldAddressTarget('/orders/o1', 'nuk')).toBe('/c/nuk/orders/o1')
  })

  it('leave the platform\'s pages, the API and assets alone', () => {
    for (const path of ['/c/nuk', '/c/nuk/admin', '/sign-in', '/table/abc', '/api/health', '/api/c/nuk/admin/me', '/_nuxt/app.js', '/media/t/x.webp', '/administrator', '/checkouts', '/favicon.ico']) {
      expect(oldAddressTarget(path, 'nuk'), path).toBeNull()
    }
  })
})
