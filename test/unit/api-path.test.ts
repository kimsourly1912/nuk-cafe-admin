import { describe, expect, it } from 'vitest'
import { apiPath } from '../../app/utils/api-path'

describe('apiPath (D140)', () => {
  it('puts a cafe\'s surfaces under its address', () => {
    expect(apiPath('/admin/menu/items', 'nuk')).toBe('/c/nuk/admin/menu/items')
    expect(apiPath('/counter/b1/orders', 'nuk')).toBe('/c/nuk/counter/b1/orders')
    expect(apiPath('/public/menu?branchId=b1', 'brown-bean')).toBe('/c/brown-bean/public/menu?branchId=b1')
    expect(apiPath('/shop/me', 'nuk')).toBe('/c/nuk/shop/me')
    expect(apiPath('/admin', 'nuk')).toBe('/c/nuk/admin')
  })

  it('leaves the platform\'s routes as they are', () => {
    expect(apiPath('/tables/abc', 'nuk')).toBe('/tables/abc')
    expect(apiPath('/auth/sign-out', 'nuk')).toBe('/auth/sign-out')
    expect(apiPath('/health', 'nuk')).toBe('/health')
    expect(apiPath('/administrator', 'nuk')).toBe('/administrator')
    expect(apiPath('/publicity', 'nuk')).toBe('/publicity')
  })
})
