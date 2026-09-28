import { FetchError } from 'ofetch'
import { describe, expect, it } from 'vitest'
import { API_ERROR_MESSAGES, ApiError, getErrorMessage } from '../../app/utils/api-error'

/** An error response body of our API (`apiError` in server/utils/errors.ts). */
const body = (statusCode: number, code: string, message: string, fieldErrors?: Record<string, string[]>) =>
  ({ error: true, statusCode, message, data: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } })

describe('ApiError.fromResponse', () => {
  it('a validation error shows the server message and keeps the field errors', () => {
    const error = ApiError.fromResponse(400, body(400, 'VALIDATION_FAILED', 'Some of the submitted data is invalid.', { name: ['Required'] }))
    expect(error).toMatchObject({ kind: 'validation', status: 400, code: 'VALIDATION_FAILED', fieldErrors: { name: ['Required'] } })
    expect(error.message).toBe('Some of the submitted data is invalid.')
  })

  it('a conflict shows the server message with its code', () => {
    const error = ApiError.fromResponse(409, body(409, 'VERSION_CONFLICT', 'This category was changed by someone else. Reload it and try again.'))
    expect(error).toMatchObject({ kind: 'conflict', code: 'VERSION_CONFLICT', message: 'This category was changed by someone else. Reload it and try again.' })
  })

  it('a missing record is not_found with the server message', () => {
    expect(ApiError.fromResponse(404, body(404, 'NOT_FOUND', 'The category was not found.'))).toMatchObject({ kind: 'not_found', message: 'The category was not found.' })
  })

  it('401 is unauthorized; 403 NOT_ADMIN keeps its code', () => {
    expect(ApiError.fromResponse(401, body(401, 'UNAUTHENTICATED', 'Sign in to continue.'))).toMatchObject({ kind: 'unauthorized', status: 401 })
    expect(ApiError.fromResponse(403, body(403, 'NOT_ADMIN', 'No admin access.'))).toMatchObject({ kind: 'forbidden', code: 'NOT_ADMIN' })
  })

  it('reads Better Auth errors ({ code, message } at the top level)', () => {
    expect(ApiError.fromResponse(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }))
      .toMatchObject({ kind: 'unauthorized', code: 'INVALID_EMAIL_OR_PASSWORD' })
    expect(ApiError.fromResponse(429, { message: 'Too many requests' })).toMatchObject({ kind: 'rate_limited', message: 'Too many requests' })
  })

  it('hides 5xx messages behind a friendly one, keeping them as detail', () => {
    const error = ApiError.fromResponse(500, { statusCode: 500, message: 'D1_ERROR: no such table' })
    expect(error).toMatchObject({ kind: 'server', message: API_ERROR_MESSAGES.server, detail: 'D1_ERROR: no such table' })
    expect(error.retryable).toBe(true)
  })

  it('non-JSON bodies fall back by status', () => {
    expect(ApiError.fromResponse(403, 'Forbidden')).toMatchObject({ kind: 'forbidden', message: API_ERROR_MESSAGES.forbidden, detail: 'Forbidden' })
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
    const original = ApiError.fromResponse(404, body(404, 'NOT_FOUND', 'Category not found'))
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
