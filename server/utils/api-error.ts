import { createError } from 'h3'
import type { ApiErrorBody, ErrorCode } from '#shared/contracts/common'

/**
 * Throws the API's error response: the HTTP status plus `ApiErrorBody` as `data`
 * (`{ statusCode, message, data: { code, message, fieldErrors? } }` in the JSON body).
 * `message` must be safe to show to users; never put internals or secrets in it.
 */
export function apiError(statusCode: number, code: ErrorCode, message: string, fieldErrors?: ApiErrorBody['fieldErrors']) {
  const data: ApiErrorBody = fieldErrors ? { code, message, fieldErrors } : { code, message }
  return createError({ statusCode, message, data })
}

export const notFound = (what: string) => apiError(404, 'NOT_FOUND', `${what} was not found. It may have been deleted.`)

export const versionConflict = (what: string) =>
  apiError(409, 'VERSION_CONFLICT', `${what} was changed by someone else. Reload it and try again.`)
