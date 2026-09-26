import type { $Fetch } from 'ofetch'
import { ofetch } from 'ofetch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../app/utils/api-error'
import { createApiFetch, REFRESH_TIMEOUT_MS } from '../../app/utils/api-fetch'

/** Minimal stand-in for an ofetch `.raw()` response. */
function res(status: number, data?: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: '', _data: data }
}

const unauthorized = () => res(401, { data: null, success: false, msg: 'NC1000', reason: 'Unauthorized' })

type Handler = (url: string, options: Record<string, unknown>) => ReturnType<typeof res> | Promise<ReturnType<typeof res>>

function setup(handler: Handler) {
  const raw = vi.fn(async (url: string, options: Record<string, unknown>) => handler(url, options))
  let generation = 0
  // Like useAuth: expiring the session moves to a new (signed-out) generation.
  const onSessionExpired = vi.fn(() => {
    generation++
  })
  const apiFetch = createApiFetch({ baseFetch: { raw } as unknown as $Fetch, onSessionExpired, sessionGeneration: () => generation })
  const call = (url: string) => apiFetch.raw(url)
  const refreshes = () => raw.mock.calls.filter(([url]) => url.includes('/refresh')).length
  return { raw, onSessionExpired, call, refreshes, changeSession: () => generation++ }
}

/** A promise resolved by hand, to control timing. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const timeoutError = () => Object.assign(new Error('[TimeoutError]: The operation was aborted due to timeout'), { name: 'TimeoutError' })

describe('createApiFetch', () => {
  it('returns successful responses', async () => {
    const { call } = setup(() => res(200, { success: true, data: 1 }))
    await expect(call('/staff/categories')).resolves.toMatchObject({ _data: { success: true, data: 1 } })
  })

  it('throws ApiError for HTTP 200 responses with success: false', async () => {
    const { call } = setup(() => res(200, { success: false, msg: 'LOGIN_FAILED', reason: 'Incorrect username or password' }))
    await expect(call('/staff/auth/login')).rejects.toMatchObject({
      name: 'ApiError',
      status: 200,
      code: 'LOGIN_FAILED',
      message: 'Incorrect username or password',
    })
  })

  it('refreshes once and retries on 401', async () => {
    let calls = 0
    const { call, raw } = setup((url) => {
      if (url.includes('/refresh')) return res(200, { success: true })
      return calls++ === 0 ? unauthorized() : res(200, { success: true, data: 'ok' })
    })
    await expect(call('/staff/categories')).resolves.toMatchObject({ _data: { data: 'ok' } })
    expect(raw).toHaveBeenCalledWith('/staff/auth/refresh', expect.objectContaining({ method: 'POST' }))
  })

  it('refreshes when the unauthorized code arrives with HTTP 200', async () => {
    let calls = 0
    const { call, raw } = setup((url) => {
      if (url.includes('/refresh')) return res(200, { success: true })
      return calls++ === 0
        ? res(200, { data: null, success: false, msg: 'NC1000', reason: 'Unauthorized' })
        : res(200, { success: true, data: 'ok' })
    })
    await expect(call('/staff/categories')).resolves.toMatchObject({ _data: { data: 'ok' } })
    expect(raw).toHaveBeenCalledWith('/staff/auth/refresh', expect.objectContaining({ method: 'POST' }))
  })

  it('shares one refresh between concurrent 401s', async () => {
    const seen = new Set<string>()
    const { call, raw } = setup((url) => {
      if (url.includes('/refresh')) return res(200, { success: true })
      if (seen.has(url)) return res(200, { success: true })
      seen.add(url)
      return unauthorized()
    })
    await Promise.all([call('/staff/a'), call('/staff/b'), call('/staff/c')])
    expect(raw.mock.calls.filter(([url]) => url.includes('/refresh'))).toHaveLength(1)
  })

  it('expires the session when refresh fails', async () => {
    const { call, onSessionExpired } = setup(unauthorized)
    await expect(call('/staff/categories')).rejects.toBeInstanceOf(ApiError)
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('concurrent 401s with a failing refresh: one refresh, one expiry', async () => {
    const gate = deferred<undefined>()
    const { call, onSessionExpired, refreshes } = setup(async (url) => {
      if (url.includes('/refresh')) await gate.promise
      return unauthorized()
    })
    const calls = [call('/staff/a'), call('/staff/b'), call('/staff/c')].map(p => p.catch((e: unknown) => e))
    await new Promise(r => setTimeout(r, 0))
    gate.resolve(undefined)
    const errors = await Promise.all(calls)
    expect(errors.every(e => e instanceof ApiError)).toBe(true)
    expect(refreshes()).toBe(1)
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('expires the session once when the retry is still unauthorized, and never refreshes again for it', async () => {
    const { call, onSessionExpired, refreshes } = setup(url => (url.includes('/refresh') ? res(200, { success: true }) : unauthorized()))
    await expect(call('/staff/categories')).rejects.toBeInstanceOf(ApiError)
    expect(refreshes()).toBe(1)
    expect(onSessionExpired).toHaveBeenCalledOnce()

    // Later calls in the same (expired) session: no refresh loop, no second expiry.
    await expect(call('/staff/categories')).rejects.toMatchObject({ kind: 'unauthorized' })
    await expect(call('/staff/products')).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(refreshes()).toBe(1)
    expect(onSessionExpired).toHaveBeenCalledOnce()
  })

  it('refreshes again after the next identity change (e.g. a new login)', async () => {
    const { call, onSessionExpired, refreshes, changeSession } = setup(unauthorized)
    await call('/staff/a').catch(() => {})
    expect(refreshes()).toBe(1)
    changeSession()
    await call('/staff/a').catch(() => {})
    expect(refreshes()).toBe(2)
    expect(onSessionExpired).toHaveBeenCalledTimes(2)
  })

  it('bounds the refresh with its own timeout', async () => {
    const { call, raw } = setup(url => (url.includes('/refresh') ? res(200, { success: true }) : unauthorized()))
    await call('/staff/categories').catch(() => {})
    expect(raw).toHaveBeenCalledWith('/staff/auth/refresh', expect.objectContaining({ method: 'POST', timeout: REFRESH_TIMEOUT_MS }))
  })

  it('a refresh that times out fails the request as a timeout and keeps the session', async () => {
    const { call, onSessionExpired, refreshes } = setup((url) => {
      if (url.includes('/refresh')) throw timeoutError()
      return unauthorized()
    })
    await expect(call('/staff/categories')).rejects.toMatchObject({ kind: 'timeout' })
    expect(onSessionExpired).not.toHaveBeenCalled()
    // Not expired: the next call may try again.
    await call('/staff/categories').catch(() => {})
    expect(refreshes()).toBe(2)
  })

  it('a refresh that can\'t reach the server keeps the session', async () => {
    const { call, onSessionExpired } = setup((url) => {
      if (url.includes('/refresh')) throw new TypeError('Failed to fetch')
      return unauthorized()
    })
    await expect(call('/staff/categories')).rejects.toMatchObject({ kind: 'network' })
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('turns off ofetch\'s automatic retries on every request', async () => {
    const { call, raw } = setup(() => res(200, { success: true }))
    await call('/staff/categories')
    expect(raw).toHaveBeenCalledWith('/staff/categories', expect.objectContaining({ retry: 0 }))
  })

  it('discards a response that arrives after the session changed', async () => {
    const gate = deferred<ReturnType<typeof res>>()
    const { call, changeSession } = setup(() => gate.promise)
    const pending = call('/staff/categories')
    changeSession() // e.g. logout, or another staff member logged in from another tab
    gate.resolve(res(200, { success: true, data: 'previous user\'s data' }))
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('does not refresh for auth endpoints', async () => {
    const { call, raw, onSessionExpired } = setup(unauthorized)
    await expect(call('/staff/auth/login')).rejects.toMatchObject({ status: 401 })
    expect(raw).toHaveBeenCalledOnce()
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('does not refresh for non-401 errors', async () => {
    const { call, raw } = setup(() => res(400, { success: false, msg: 'VALIDATION', reason: 'Name is required' }))
    await expect(call('/staff/categories')).rejects.toMatchObject({ status: 400, message: 'Name is required' })
    expect(raw).toHaveBeenCalledOnce()
  })

  it('wraps network failures in ApiError', async () => {
    const { call } = setup(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(call('/staff/categories')).rejects.toMatchObject({ name: 'ApiError', status: 0 })
  })
})

describe('with real ofetch', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ofetch alone retries a failed GET once; createApiFetch sends it once', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const base = ofetch.create({ baseURL: 'http://api.test' }, { fetch: fetch as unknown as typeof globalThis.fetch })
    await base.raw('/staff/categories').catch(() => {})
    expect(fetch).toHaveBeenCalledTimes(2) // why createApiFetch passes retry: 0

    fetch.mockClear()
    const apiFetch = createApiFetch({ baseFetch: base, onSessionExpired: () => {} })
    await apiFetch.raw('/staff/categories').catch(() => {})
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a hung refresh times out after REFRESH_TIMEOUT_MS and keeps the session', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      if (String(request).includes('/refresh')) {
        // Never answers; only the timeout's abort ends it.
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
      }
      return new Response(JSON.stringify({ success: false, msg: 'NC1000', reason: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } })
    })
    const onSessionExpired = vi.fn()
    const base = ofetch.create({ baseURL: 'http://api.test' }, { fetch: fetch as unknown as typeof globalThis.fetch })
    const apiFetch = createApiFetch({ baseFetch: base, onSessionExpired })

    let settled = false
    const pending = apiFetch.raw('/staff/categories').catch((e: unknown) => e).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({ kind: 'timeout' })
    expect(onSessionExpired).not.toHaveBeenCalled()
  })
})
