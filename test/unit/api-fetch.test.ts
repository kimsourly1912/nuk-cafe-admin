import type { $Fetch } from 'ofetch'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../app/utils/api-error'
import { createApiFetch } from '../../app/utils/api-fetch'

/** Minimal stand-in for an ofetch `.raw()` response. */
function res(status: number, data?: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: '', _data: data }
}

const unauthorized = () => res(401, { data: null, success: false, msg: 'NC1000', reason: 'Unauthorized' })

function setup(handler: (url: string) => ReturnType<typeof res>) {
  const raw = vi.fn(async (url: string) => handler(url))
  const onSessionExpired = vi.fn()
  const apiFetch = createApiFetch({ baseFetch: { raw } as unknown as $Fetch, onSessionExpired })
  const call = (url: string) => apiFetch.raw(url)
  return { raw, onSessionExpired, call }
}

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
