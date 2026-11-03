import type { $Fetch } from 'ofetch'
import { FetchError } from 'ofetch'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../app/utils/api-error'
import { createApiFetch } from '../../app/utils/api-fetch'

/** An ofetch stand-in: `respond` decides each call's outcome. */
function fakeFetch(respond: (path: string, options?: Record<string, unknown>) => Promise<unknown>) {
  const calls: { path: string, options?: Record<string, unknown> }[] = []
  const fetch = (async (path: string, options?: Record<string, unknown>) => {
    calls.push({ path, options })
    return respond(path, options)
  }) as unknown as $Fetch
  return { fetch, calls }
}

/** An HTTP error the way ofetch throws it. */
function httpError(status: number, data: unknown) {
  return Object.assign(new FetchError(`[GET] "/x": ${status}`), { response: { status } as Response, data, statusCode: status })
}

const errorBody = (code: string, message: string) => ({ statusCode: 0, message, data: { code, message } })

describe('createApiFetch', () => {
  it('returns the body and never lets ofetch retry', async () => {
    const { fetch, calls } = fakeFetch(async () => ({ id: 'cat-1' }))
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost: vi.fn() })
    expect(await apiFetch('/admin/categories/cat-1')).toEqual({ id: 'cat-1' })
    expect(calls[0]!.options).toMatchObject({ retry: 0 })
  })

  it('throws ApiError with the server message and code', async () => {
    const { fetch } = fakeFetch(async () => {
      throw httpError(409, errorBody('VERSION_CONFLICT', 'Changed by someone else.'))
    })
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost: vi.fn() })
    const error = await apiFetch('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'conflict', code: 'VERSION_CONFLICT', message: 'Changed by someone else.' })
  })

  it('reports a lost session on 401 and on 403 NOT_ADMIN, not on other 403s', async () => {
    const onSessionLost = vi.fn()
    let next: unknown
    const { fetch } = fakeFetch(async () => {
      throw next
    })
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost })

    next = httpError(401, errorBody('UNAUTHENTICATED', 'Sign in to continue.'))
    await apiFetch('/x').catch(() => {})
    next = httpError(403, errorBody('NOT_ADMIN', 'No admin access.'))
    await apiFetch('/x').catch(() => {})
    next = httpError(403, errorBody('FORBIDDEN', 'Not allowed.'))
    await apiFetch('/x').catch(() => {})
    expect(onSessionLost).toHaveBeenCalledTimes(2)
  })

  it('reports a required password change, which is not a lost session', async () => {
    const onSessionLost = vi.fn()
    const onPasswordChangeRequired = vi.fn()
    const { fetch } = fakeFetch(async () => {
      throw httpError(403, errorBody('PASSWORD_CHANGE_REQUIRED', 'Change your temporary password to continue.'))
    })
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost, onPasswordChangeRequired })
    await expect(apiFetch('/x')).rejects.toMatchObject({ kind: 'forbidden', code: 'PASSWORD_CHANGE_REQUIRED' })
    expect(onPasswordChangeRequired).toHaveBeenCalledTimes(1)
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('discards a response from a previous identity, success or failure, silently', async () => {
    let generation = 1
    let release!: (value: unknown) => void
    const { fetch } = fakeFetch(() => new Promise((resolve) => {
      release = resolve
    }))
    const onSessionLost = vi.fn()
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost, sessionGeneration: () => generation })

    const pending = apiFetch('/admin/categories').catch((e: unknown) => e)
    generation = 2 // signed out / another user signed in meanwhile
    release([{ id: 'cat-1' }])
    expect(await pending).toMatchObject({ kind: 'aborted' })
    expect(onSessionLost).not.toHaveBeenCalled()
  })

  it('maps a network failure to a retryable error', async () => {
    const { fetch } = fakeFetch(async () => {
      throw Object.assign(new FetchError('[GET] "/x": <no response> Failed to fetch'), { cause: new TypeError('Failed to fetch') })
    })
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost: vi.fn() })
    const error = await apiFetch('/x').catch((e: unknown) => e) as ApiError
    expect(error.kind).toBe('network')
    expect(error.retryable).toBe(true)
  })

  it.each([200, 401, 403])('a superseded session read (%s) cannot restore flags or end the newer session', async (status) => {
    let current = true
    const onSessionLost = vi.fn()
    const onPasswordChangeRequired = vi.fn()
    const { fetch, calls } = fakeFetch(async () => {
      current = false // a newer password/2FA/session update won while this read was in flight
      if (status !== 200) throw httpError(status, errorBody(status === 401 ? 'UNAUTHENTICATED' : 'PASSWORD_CHANGE_REQUIRED', 'Old session'))
      return { mustChangePassword: true, twoFactorEnabled: false }
    })
    const request = createApiFetch({ baseFetch: fetch, onSessionLost, onPasswordChangeRequired })
    await expect(request('/admin/me', { isCurrent: () => current })).rejects.toMatchObject({ kind: 'aborted' })
    expect(onSessionLost).not.toHaveBeenCalled()
    expect(onPasswordChangeRequired).not.toHaveBeenCalled()
    expect(calls[0]!.options).not.toHaveProperty('isCurrent')
  })
})

describe('a dangerous change that needs the password again (D246)', () => {
  const needsConfirmation = () => httpError(403, errorBody('CONFIRMATION_REQUIRED', 'Confirm it\'s you.'))
  const body = { version: 3, enabled: true }
  const headers = { 'Idempotency-Key': 'key-1' }

  it('asks, then sends the same request once more and returns its answer', async () => {
    let refused = false
    const { fetch, calls } = fakeFetch(async () => {
      if (!refused) {
        refused = true
        throw needsConfirmation()
      }
      return { saved: true }
    })
    const ask = vi.fn(async () => true)
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost: vi.fn(), onConfirmationRequired: ask })
    expect(await apiFetch('/admin/khqr', { method: 'PUT', body, headers })).toEqual({ saved: true })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    // The same request: body (with its version) and idempotency key unchanged.
    expect(calls[1]).toEqual(calls[0])
  })

  it('cancelled: nothing is sent again, and the failure is silent', async () => {
    const { fetch, calls } = fakeFetch(async () => {
      throw needsConfirmation()
    })
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost: vi.fn(), onConfirmationRequired: async () => false })
    const error = await apiFetch('/admin/khqr', { method: 'PUT', body }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'aborted' })
    expect(calls).toHaveLength(1)
  })

  it('asks once: refused again after confirming, the refusal is shown, no second dialog', async () => {
    const { fetch, calls } = fakeFetch(async () => {
      throw needsConfirmation()
    })
    // Says yes only the first time, so asking again can't loop: it would end as `aborted`.
    const ask = vi.fn(async () => ask.mock.calls.length === 1)
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost: vi.fn(), onConfirmationRequired: ask })
    const error = await apiFetch('/admin/khqr', { method: 'PUT', body }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'forbidden', code: 'CONFIRMATION_REQUIRED' })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
  })

  it('the session changed while asking: discarded, not sent again', async () => {
    let generation = 1
    const { fetch, calls } = fakeFetch(async () => {
      throw needsConfirmation()
    })
    const apiFetch = createApiFetch({
      baseFetch: fetch,
      onSessionLost: vi.fn(),
      sessionGeneration: () => generation,
      onConfirmationRequired: async () => {
        generation++
        return true
      },
    })
    const error = await apiFetch('/admin/khqr', { method: 'PUT', body }).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'aborted' })
    expect(calls).toHaveLength(1)
  })

  it('without a handler (or another 403) it\'s an ordinary refusal', async () => {
    const { fetch } = fakeFetch(async () => {
      throw needsConfirmation()
    })
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost: vi.fn() })
    expect(await apiFetch('/admin/khqr').catch((e: unknown) => e)).toMatchObject({ kind: 'forbidden', code: 'CONFIRMATION_REQUIRED' })
  })
})
