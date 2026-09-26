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

  it('reports a lost session on 401 and on 403 NOT_STAFF, not on other 403s', async () => {
    const onSessionLost = vi.fn()
    let next: unknown
    const { fetch } = fakeFetch(async () => {
      throw next
    })
    const apiFetch = createApiFetch({ baseFetch: fetch, onSessionLost })

    next = httpError(401, errorBody('UNAUTHENTICATED', 'Sign in to continue.'))
    await apiFetch('/x').catch(() => {})
    next = httpError(403, errorBody('NOT_STAFF', 'No staff access.'))
    await apiFetch('/x').catch(() => {})
    next = httpError(403, errorBody('FORBIDDEN', 'Not allowed.'))
    await apiFetch('/x').catch(() => {})
    expect(onSessionLost).toHaveBeenCalledTimes(2)
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
})
