import { createError } from 'h3'
import { describe, expect, it } from 'vitest'
import { apiError, ErrorCodes, toErrorResponse } from '#server/utils/errors'

describe('apiError', () => {
  it('carries the status, code, user message and field errors', () => {
    const error = apiError(400, ErrorCodes.VALIDATION_FAILED, 'Some of the submitted data is invalid.', { fieldErrors: { name: ['Required'] } })
    expect(error.statusCode).toBe(400)
    expect(error.data).toEqual({ code: 'VALIDATION_FAILED', message: 'Some of the submitted data is invalid.', fieldErrors: { name: ['Required'] } })
  })
})

describe('toErrorResponse', () => {
  it('sends a 4xx apiError as it is, plus the request id', () => {
    const response = toErrorResponse(apiError(409, 'VERSION_CONFLICT', 'Changed by someone else.'), 'req-1')
    expect(response).toEqual({
      status: 409,
      isServerError: false,
      body: { statusCode: 409, message: 'Changed by someone else.', data: { code: 'VERSION_CONFLICT', message: 'Changed by someone else.', requestId: 'req-1' } },
    })
  })

  it('gives a shared code and a generic message to 4xx errors without one (h3\'s 404, a library\'s 401)', () => {
    expect(toErrorResponse(createError({ statusCode: 404, message: 'Cannot find any path matching /api/nope' })).body.data)
      .toEqual({ code: 'NOT_FOUND', message: 'Not found.' })
    expect(toErrorResponse(createError({ statusCode: 401, message: 'Unauthorized' })).body.data)
      .toEqual({ code: 'UNAUTHENTICATED', message: 'Sign in to continue.' })
    expect(toErrorResponse(createError({ statusCode: 429 })).body.data.code).toBe('RATE_LIMITED')
  })

  it('never lets a 5xx carry details, even an apiError', () => {
    for (const error of [
      new Error('D1_ERROR: no such table: menu_items'),
      createError({ statusCode: 500, message: 'SQLITE_CONSTRAINT', data: { code: 'X', message: 'leak' } }),
      apiError(503, 'SOMETHING', 'internal detail'),
    ]) {
      const response = toErrorResponse(error, 'req-2')
      expect(response.status).toBeGreaterThanOrEqual(500)
      expect(response.isServerError).toBe(true)
      expect(response.body.message).toBe('Something went wrong on our side. Please try again.')
      expect(response.body.data).toEqual({ code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', requestId: 'req-2' })
    }
  })

  it('treats anything that isn\'t an HTTP error as a 500', () => {
    expect(toErrorResponse('boom').status).toBe(500)
    expect(toErrorResponse(undefined).status).toBe(500)
  })
})
