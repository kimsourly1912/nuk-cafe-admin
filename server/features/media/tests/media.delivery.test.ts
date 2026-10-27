import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MAX_BYTES } from '#shared/contracts/media'
import { PUBLIC_IMAGE_BROWSER_CACHE, servePublicImage } from '#server/features/media/media.delivery'

const path = '/media/t/cafe-a/menu/photo.webp'
const request = (pathname = path, init?: RequestInit) => new Request(`https://staging.cafe.test${pathname}`, init)
const image = (body = 'photo-a', headers: HeadersInit = {}, status = 200) => new Response(body, {
  status,
  headers: {
    'content-type': 'image/webp', 'content-length': String(body.length),
    'cache-control': PUBLIC_IMAGE_BROWSER_CACHE, 'etag': `"${body}"`,
    'x-content-type-options': 'nosniff', 'x-request-id': 'origin-request',
    'content-security-policy': 'default-src \'self\'', ...headers,
  },
})

function fixture() {
  const values = new Map<string, Response>()
  const tasks: Promise<unknown>[] = []
  const cache = {
    match: vi.fn(async (key: RequestInfo | URL) => values.get(new Request(key).url)?.clone()),
    put: vi.fn(async (key: RequestInfo | URL, response: Response) => { values.set(new Request(key).url, response.clone()) }),
  }
  const options = {
    openCache: vi.fn(async () => cache),
    waitUntil: (task: Promise<unknown>) => { tasks.push(task) },
  }
  return { cache, values, tasks, options }
}

afterEach(() => vi.restoreAllMocks())

describe('public image edge delivery', () => {
  it('serves the same bytes and ETag on a warm hit without reading storage again', async () => {
    const { options, tasks, cache, values } = fixture()
    const read = vi.fn(async () => image())
    const first = await servePublicImage(request(), read, options)
    expect(first.headers.get('x-media-cache')).toBe('MISS')
    expect(await first.text()).toBe('photo-a')
    await Promise.all(tasks)
    const second = await servePublicImage(request(), read, options)
    expect(await second.text()).toBe('photo-a')
    expect(second.headers.get('etag')).toBe('"photo-a"')
    expect(second.headers.get('x-media-cache')).toBe('HIT')
    expect(second.headers.get('cache-control')).toBe(PUBLIC_IMAGE_BROWSER_CACHE)
    expect(second.headers.get('x-content-type-options')).toBe('nosniff')
    expect(second.headers.has('x-request-id')).toBe(false)
    expect(second.headers.has('content-security-policy')).toBe(false)
    expect(read).toHaveBeenCalledTimes(1)
    expect(cache.put).toHaveBeenCalledTimes(1)
    expect(values.get(request().url)!.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('separates two cafes, a replacement photo, and staging from production', async () => {
    const { options, tasks } = fixture()
    const paths = [path, '/media/t/cafe-b/menu/photo.webp', '/media/t/cafe-a/menu/replacement.webp']
    for (const [index, pathname] of paths.entries()) {
      expect(await (await servePublicImage(request(pathname), async () => image(`photo-${index}`), options)).text()).toBe(`photo-${index}`)
    }
    const production = new Request(`https://cafe.test${path}`)
    await servePublicImage(production, async () => image('production'), options)
    await Promise.all(tasks)
    const mustNotRead = vi.fn(async () => {
      throw new Error('Unexpected storage read')
    })
    for (const [index, pathname] of paths.entries()) {
      expect(await (await servePublicImage(request(pathname), mustNotRead, options)).text()).toBe(`photo-${index}`)
    }
    expect(await (await servePublicImage(production, mustNotRead, options)).text()).toBe('production')
    expect(mustNotRead).not.toHaveBeenCalled()
  })

  it('supports legacy public files and never stores visitor credentials in cache keys', async () => {
    const { options, cache, tasks } = fixture()
    const read = vi.fn(async () => image())
    await servePublicImage(request('/media/menu/legacy.jpg', { headers: { cookie: 'session=first' } }), read, options)
    await Promise.all(tasks)
    const key = cache.put.mock.calls[0]![0] as Request
    expect([...key.headers]).toEqual([])
    expect((await servePublicImage(request('/media/menu/legacy.jpg', { headers: { cookie: 'session=second' } }), read, options)).headers.get('x-media-cache')).toBe('HIT')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it.each([
    '/media/t/cafe-a/source/photo.webp', '/api/c/cafe-a/admin/media/photos/id/source',
    '/api/auth/sign-in/email', '/api/c/cafe-a/shop/orders', '/c/cafe-a/checkout',
    '/media/t/cafe-a/menu/sub/photo.webp', '/media/menu/photo.svg',
    '/media/menu/photo%2ewebp', '/media/menu/photo.webp?width=100',
  ])('does not consult or populate an image cache for %s', async (pathname) => {
    const { options, cache } = fixture()
    const original = image()
    expect(await servePublicImage(request(pathname), async () => original, options)).toBe(original)
    expect(options.openCache).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  const bypassRequests: RequestInit[] = [
    { method: 'HEAD' }, { method: 'POST' },
    { headers: { authorization: 'Bearer example' } },
    { headers: { range: 'bytes=0-2' } }, { headers: { 'if-range': '"etag"' } },
    { headers: { 'if-none-match': '"etag"' } }, { headers: { 'if-match': '"etag"' } },
    { headers: { 'if-modified-since': 'Tue, 27 Oct 2026 00:00:00 GMT' } },
    { headers: { 'if-unmodified-since': 'Tue, 27 Oct 2026 00:00:00 GMT' } },
  ]
  it.each(bypassRequests)('leaves non-GET/authenticated/conditional/range requests to the existing handler: %j', async (init) => {
    const { options } = fixture()
    await servePublicImage(request(path, init), async () => image(), options)
    expect(options.openCache).not.toHaveBeenCalled()
  })

  it.each([
    [404, {}], [500, {}], [206, { 'content-range': 'bytes 0-6/20' }],
    [200, { 'set-cookie': 'session=example' }], [200, { vary: 'Cookie' }],
    [200, { 'cache-control': 'private, no-store' }], [200, { 'content-type': 'text/html' }],
    [200, { 'content-length': '0' }], [200, { 'content-length': String(IMAGE_MAX_BYTES + 1) }],
  ] as const)('never caches unsafe responses: HTTP %i, %j', async (status, headers) => {
    const { options, cache } = fixture()
    const result = await servePublicImage(request(), async () => image('example', headers, status), options)
    expect(result.status).toBe(status)
    expect(result.headers.get('x-media-cache')).toBe('BYPASS')
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('does not turn a missing object into a negative cache entry, so a later upload works', async () => {
    const { options, tasks, cache } = fixture()
    await expect(servePublicImage(request(), async () => {
      throw new Error('File not found')
    }, options)).rejects.toThrow('File not found')
    expect(cache.put).not.toHaveBeenCalled()
    expect((await servePublicImage(request(), async () => image('uploaded'), options)).status).toBe(200)
    await Promise.all(tasks)
    expect((await servePublicImage(request(), async () => image(), options)).headers.get('x-media-cache')).toBe('HIT')
  })

  it('falls back to the original image when cache opening, reading or writing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const operation of ['open', 'match', 'put'] as const) {
      const { options, cache, tasks } = fixture()
      if (operation === 'open') options.openCache.mockRejectedValue(new Error('Unavailable'))
      else cache[operation].mockRejectedValue(new Error('Unavailable'))
      const result = await servePublicImage(request(), async () => image(), options)
      expect(await result.text()).toBe('photo-a')
      await Promise.all(tasks)
    }
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('registers a background write without making response delivery await its completion', async () => {
    const { options, cache, tasks } = fixture()
    let finish!: () => void
    cache.put.mockImplementation(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const response = await servePublicImage(request(), async () => image(), options)
    expect(await response.text()).toBe('photo-a')
    expect(tasks).toHaveLength(1)
    finish()
    await Promise.all(tasks)
  })
})
