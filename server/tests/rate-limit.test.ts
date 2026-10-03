import { describe, expect, it } from 'vitest'
import type { RateLimiter } from '#server/utils/rate-limit'
import { checkRateLimit, RATE_LIMIT_RULES, rateLimited, rateLimitPath } from '#server/utils/rate-limit'

/** Allows `limit` calls per key, like Cloudflare's binding within one period. */
function fakeLimiter(limit: number) {
  const counts = new Map<string, number>()
  const keys: string[] = []
  const limiter: RateLimiter = {
    limit: async ({ key }) => {
      keys.push(key)
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limit }
    },
  }
  return { limiter, keys }
}

describe('public API rate limits (D121)', () => {
  it('the quote has its own, smaller limit; other public routes share the general one', async () => {
    const quote = fakeLimiter(2)
    const general = fakeLimiter(100)
    const limiters = { RATE_LIMIT_QUOTE: quote.limiter, RATE_LIMIT_PUBLIC: general.limiter }
    const request = (path: string) => checkRateLimit({ path, address: '203.0.113.7', limiters })

    expect(await request('/api/c/nuk/public/checkout/quote')).toEqual({ checked: true, limited: null })
    expect(await request('/api/c/nuk/public/checkout/quote')).toEqual({ checked: true, limited: null })
    expect(await request('/api/c/nuk/public/checkout/quote')).toEqual({ checked: true, limited: 'RATE_LIMIT_QUOTE' })
    // The menu still loads for the same address.
    expect(await request('/api/c/nuk/public/menu')).toEqual({ checked: true, limited: null })
    expect(quote.keys).toEqual(['203.0.113.7', '203.0.113.7', '203.0.113.7'])
    expect(general.keys).toEqual(['203.0.113.7'])
  })

  it('counts per address: another visitor isn\'t limited by the first', async () => {
    const quote = fakeLimiter(1)
    const limiters = { RATE_LIMIT_QUOTE: quote.limiter }
    await checkRateLimit({ path: '/api/public/checkout/quote', address: '203.0.113.7', limiters })
    expect((await checkRateLimit({ path: '/api/public/checkout/quote', address: '203.0.113.7', limiters })).limited).toBe('RATE_LIMIT_QUOTE')
    expect((await checkRateLimit({ path: '/api/public/checkout/quote', address: '198.51.100.2', limiters })).limited).toBeNull()
  })

  it('checks nothing without a binding (dev server, tests), without an address, or outside the public API', async () => {
    const general = fakeLimiter(0)
    expect(await checkRateLimit({ path: '/api/public/menu', address: '203.0.113.7', limiters: {} })).toEqual({ checked: false, limited: null })
    expect(await checkRateLimit({ path: '/api/public/menu', address: undefined, limiters: { RATE_LIMIT_PUBLIC: general.limiter } })).toEqual({ checked: false, limited: null })
    expect(await checkRateLimit({ path: '/api/c/nuk/shop/orders', address: '203.0.113.7', limiters: { RATE_LIMIT_PUBLIC: general.limiter } })).toEqual({ checked: false, limited: null })
    expect(general.keys).toEqual([])
  })

  it('the quote rule comes first, so it wins over the general prefix', () => {
    expect(RATE_LIMIT_RULES[0].prefix).toBe('/api/public/checkout/quote')
    expect(RATE_LIMIT_RULES.every(rule => rule.prefix.startsWith('/api/public/') || rule.prefix === '/api/tables/')).toBe(true)
  })

  it('counts every cafe\'s public routes and the table scan by one address (D140)', async () => {
    expect(rateLimitPath('/api/c/nuk/public/menu')).toBe('/api/public/menu')
    expect(rateLimitPath('/api/c/brown-bean/public/checkout/quote')).toBe('/api/public/checkout/quote')
    expect(rateLimitPath('/api/public/menu')).toBe('/api/public/menu')
    expect(rateLimitPath('/api/c/nuk')).toBe('/api/c/nuk')
    const general = fakeLimiter(2)
    const limiters = { RATE_LIMIT_PUBLIC: general.limiter }
    const request = (path: string) => checkRateLimit({ path, address: '203.0.113.7', limiters })
    expect((await request('/api/c/nuk/public/menu')).limited).toBeNull()
    expect((await request('/api/tables/abc')).limited).toBeNull()
    // A second cafe's address doesn't start a fresh count.
    expect((await request('/api/c/other/public/menu')).limited).toBe('RATE_LIMIT_PUBLIC')
  })

  it('refuses with 429 RATE_LIMITED and a message safe to show', () => {
    const error = rateLimited()
    expect(error.statusCode).toBe(429)
    expect(error.data).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests from your connection. Wait a minute and try again.' })
  })
})
