import { describe, expect, inject, it } from 'vitest'

// Real production-mode HTTP responses, no API mocks or browser executable required.
const host = inject('e2eHost')
const directives = (policy: string) => Object.fromEntries(policy.split(';').map((part) => {
  const [name, ...sources] = part.trim().split(/\s+/)
  return [name, sources]
}))

describe('analytics and sensitive-page headers', () => {
  it('allows only the automatic beacon script on a public menu, preserving same-origin connections', async () => {
    const response = await fetch(`${host}/c/nuk`)
    expect(response.status).toBe(200)
    const csp = directives(response.headers.get('content-security-policy')!)
    expect(csp['script-src']).toContain('https://static.cloudflareinsights.com/beacon.min.js')
    expect(csp['script-src']).toContain('https://static.cloudflareinsights.com/beacon.min.js/')
    expect(csp['connect-src']).toEqual(['\'self\''])
    expect(csp['frame-ancestors']).toEqual(['\'none\''])
    expect(response.headers.get('referrer-policy')).toBe('strict-origin')
    expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000')
  })

  it.each([
    '/table/not-a-real-token',
    '/reset-password?token=not-a-secret',
    '/c/nuk/orders/not-a-real-order',
    '/c/nuk/checkout',
    '/c/nuk/admin/login',
    '/c/nuk/counter/login',
    '/platform/sign-in',
  ])('keeps the third-party beacon blocked on a direct visit to %s', async (path) => {
    const response = await fetch(`${host}${path}`, { redirect: 'manual' })
    const csp = directives(response.headers.get('content-security-policy')!)
    expect(csp['script-src']).toEqual(['\'self\'', '\'unsafe-inline\''])
    expect(csp['connect-src']).toEqual(['\'self\''])
    expect(response.headers.get('referrer-policy')).toBe('strict-origin')
  })

  it.each(['/table/not-a-real-token', '/reset-password?token=not-a-secret', '/verify-email'])('prevents edge HTML transformation and caching on %s', async (path) => {
    const response = await fetch(`${host}${path}`, { redirect: 'manual' })
    const cache = response.headers.get('cache-control')!
    expect(cache).toContain('no-transform')
    expect(cache).toContain('no-store')
  })
})
