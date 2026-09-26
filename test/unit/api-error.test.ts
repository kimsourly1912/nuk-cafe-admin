import { FetchError } from 'ofetch'
import { describe, expect, it } from 'vitest'
import { API_ERROR_MESSAGES, ApiError, getErrorMessage } from '../../app/utils/api-error'

const envelope = (msg: string, reason: string) => ({ data: null, success: false, msg, reason })

// Cases below mirror real responses observed from the dev API.
describe('ApiError.fromResponse', () => {
  it('HTTP 200 validation error shows the backend reason', () => {
    const error = ApiError.fromResponse(200, envelope('NC0001', 'Required fields are missing: password, username'))
    expect(error).toMatchObject({ kind: 'validation', status: 200, code: 'NC0001', message: 'Required fields are missing: password, username' })
  })

  it('HTTP 200 not-found error shows the backend reason', () => {
    expect(ApiError.fromResponse(200, envelope('NC0011', 'Category not found'))).toMatchObject({ kind: 'not_found', message: 'Category not found' })
  })

  it('HTTP 200 wrong login is a business error with the backend reason', () => {
    expect(ApiError.fromResponse(200, envelope('LOGIN_FAILED', 'Incorrect username or password')))
      .toMatchObject({ kind: 'business', message: 'Incorrect username or password' })
  })

  it('hides technical reasons (NC0000) behind a friendly message but keeps them as detail', () => {
    const reason = 'No static resource public/nope for request \'/nukcafe/api/v2/public/nope\'.'
    const error = ApiError.fromResponse(200, envelope('NC0000', reason))
    expect(error.message).toBe(API_ERROR_MESSAGES.unknown)
    expect(error.detail).toBe(reason)
  })

  it('unknown code with HTTP 200 is a business error showing the reason', () => {
    expect(ApiError.fromResponse(200, envelope('NC0099', 'Reward is out of stock')))
      .toMatchObject({ kind: 'business', message: 'Reward is out of stock' })
  })

  it('HTTP 401 envelope is unauthorized', () => {
    expect(ApiError.fromResponse(401, envelope('NC1000', 'Unauthorized'))).toMatchObject({ kind: 'unauthorized', status: 401 })
  })

  it('unauthorized code sent with HTTP 200 is still unauthorized', () => {
    expect(ApiError.fromResponse(200, envelope('NC1000', 'Unauthorized')).kind).toBe('unauthorized')
  })

  it('non-envelope plain text (CORS rejection) falls back by status', () => {
    const error = ApiError.fromResponse(403, 'Invalid CORS request')
    expect(error).toMatchObject({ kind: 'forbidden', message: API_ERROR_MESSAGES.forbidden, detail: 'Invalid CORS request' })
  })

  it('Spring default error JSON falls back by status and keeps the message as detail', () => {
    const error = ApiError.fromResponse(500, { timestamp: 'x', status: 500, error: 'Internal Server Error', message: 'NullPointerException' })
    expect(error).toMatchObject({ kind: 'server', message: API_ERROR_MESSAGES.server, detail: 'NullPointerException' })
    expect(error.retryable).toBe(true)
  })

  it('gateway HTML error is a server error', () => {
    expect(ApiError.fromResponse(502, '<html><body>Bad Gateway</body></html>').kind).toBe('server')
  })
})

describe('ApiError.from', () => {
  it('maps fetch network failures', () => {
    const error = ApiError.from(new TypeError('Failed to fetch'))
    expect(error).toMatchObject({ kind: 'network', status: 0, message: API_ERROR_MESSAGES.network })
    expect(error.retryable).toBe(true)
  })

  it('maps ofetch errors without a response by their cause', () => {
    const timeout = new FetchError('[GET] "/x": <no response> The operation timed out.')
    Object.assign(timeout, { cause: new DOMException('The operation timed out.', 'TimeoutError') })
    expect(ApiError.from(timeout).kind).toBe('timeout')

    const aborted = new FetchError('[GET] "/x": <no response> aborted')
    Object.assign(aborted, { cause: new DOMException('aborted', 'AbortError') })
    expect(ApiError.from(aborted).kind).toBe('aborted')
  })

  it('unwraps an ApiError wrapped by NuxtError (useAsyncData) via cause', () => {
    const original = ApiError.fromResponse(200, envelope('NC0011', 'Category not found'))
    const wrapped = Object.assign(new Error('Category not found'), { cause: original })
    expect(ApiError.from(wrapped)).toBe(original)
  })

  it('classifies a NuxtError whose cause was replaced by the ApiError\'s own cause', () => {
    // Mirrors h3 createError(input): `new H3Error(input.message, { cause: input.cause || input })`,
    // so the ApiError drops out of the chain and only the raw TypeError remains (seen in the browser).
    const apiError = ApiError.from(new TypeError('Failed to fetch'))
    const nuxtError = new Error(apiError.message, { cause: apiError.cause || apiError })
    expect(nuxtError.cause).not.toBe(apiError)
    expect(ApiError.from(nuxtError).kind).toBe('network')
  })

  it('does not mistake a programming TypeError for a network failure', () => {
    expect(ApiError.from(new TypeError('Cannot read properties of undefined (reading \'id\')')).kind).toBe('unknown')
  })

  it('never exposes unexpected error messages', () => {
    expect(getErrorMessage(new Error('Cannot read properties of undefined'))).toBe(API_ERROR_MESSAGES.unknown)
  })
})
