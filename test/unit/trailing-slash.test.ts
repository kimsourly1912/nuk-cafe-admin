import { describe, expect, it } from 'vitest'
import { withoutTrailingSlash } from '#shared/utils/address'

describe('one address per page, without a trailing slash (D208)', () => {
  it('drops the trailing slashes, keeping the query and hash', () => {
    expect(withoutTrailingSlash('/c/nuk/')).toBe('/c/nuk')
    expect(withoutTrailingSlash('/c/nuk//')).toBe('/c/nuk')
    expect(withoutTrailingSlash('/c/nuk/?table=1')).toBe('/c/nuk?table=1')
    expect(withoutTrailingSlash('/c/nuk/admin/products/?item=i1#x')).toBe('/c/nuk/admin/products?item=i1#x')
    expect(withoutTrailingSlash('/c/nuk/admin/login/?redirect=/c/nuk/admin/')).toBe('/c/nuk/admin/login?redirect=/c/nuk/admin/')
    expect(withoutTrailingSlash('/sign-in/')).toBe('/sign-in')
    expect(withoutTrailingSlash('/c/caf%C3%A9/')).toBe('/c/caf%C3%A9')
  })

  it('leaves alone addresses without one, the root, the API and Nuxt\'s files', () => {
    for (const address of ['/', '/?x=1', '/c/nuk', '/c/nuk?redirect=/c/nuk/', '/c/nuk#a/', '/api/c/nuk/public/menu/', '/api/', '/_nuxt/x/', '/__nuxt_island/', '/@vite/client/']) {
      expect(withoutTrailingSlash(address), address).toBeNull()
    }
  })

  it('never makes an address that reads as another site', () => {
    for (const address of ['//', '//evil.example/', '///evil.example/', '/\\evil.example/', '/\\/evil.example/', '/c//evil.example/', '/\tevil/', '/ evil/']) {
      expect(withoutTrailingSlash(address), address).toBeNull()
    }
  })
})
