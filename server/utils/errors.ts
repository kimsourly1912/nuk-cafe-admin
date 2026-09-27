import { createError, isError } from 'h3'
import type { ApiErrorBody } from '#shared/contracts/common'

/**
 * Error codes shared by every feature (docs/server/architecture.md → Errors). A feature's own
 * codes live in its `*.errors.ts`. The HTTP status says the kind; the code says the reason.
 */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  INVALID_STATE: 'INVALID_STATE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA: 'UNSUPPORTED_MEDIA',
  IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const

/**
 * Creates (for `throw`) an API error: the HTTP status plus `{ code, message, fieldErrors? }` as
 * `data`. `message` must be safe to show to users: never internals, never secrets.
 *
 * @example throw apiError(409, 'VERSION_CONFLICT', 'This item was changed by someone else. Reload it and try again.')
 */
export function apiError(statusCode: number, code: string, message: string, options: { fieldErrors?: Record<string, string[]> } = {}) {
  const data: ApiErrorBody = options.fieldErrors ? { code, message, fieldErrors: options.fieldErrors } : { code, message }
  return createError({ statusCode, message, data })
}

export const notFound = (what: string) => apiError(404, ErrorCodes.NOT_FOUND, `${what} was not found.`)

export const versionConflict = (what: string) =>
  apiError(409, ErrorCodes.VERSION_CONFLICT, `${what} was changed by someone else. Reload it and try again.`)

/** Default codes for errors thrown without one (h3's own 404/405, a library's 401…). */
function codeForStatus(status: number): string {
  if (status === 400 || status === 422) return ErrorCodes.VALIDATION_FAILED
  if (status === 401) return ErrorCodes.UNAUTHENTICATED
  if (status === 403) return ErrorCodes.FORBIDDEN
  if (status === 404 || status === 405) return ErrorCodes.NOT_FOUND
  if (status === 409) return ErrorCodes.VERSION_CONFLICT
  if (status === 413) return ErrorCodes.PAYLOAD_TOO_LARGE
  if (status === 415) return ErrorCodes.UNSUPPORTED_MEDIA
  if (status === 429) return ErrorCodes.RATE_LIMITED
  return ErrorCodes.INTERNAL
}

const GENERIC_MESSAGE: Record<number, string> = {
  400: 'Some of the submitted data is invalid.',
  401: 'Sign in to continue.',
  403: 'You don\'t have permission to do this.',
  404: 'Not found.',
  405: 'Not found.',
}

function isApiErrorData(data: unknown): data is ApiErrorBody {
  return typeof data === 'object' && data !== null
    && typeof (data as ApiErrorBody).code === 'string' && typeof (data as ApiErrorBody).message === 'string'
}

export interface ErrorResponse {
  status: number
  body: { statusCode: number, message: string, data: ApiErrorBody & { requestId?: string } }
  /** 5xx: our fault, log the cause. */
  isServerError: boolean
}

/**
 * The response for any error thrown while handling an `/api` request (used by
 * server/error-handler.ts):
 * - 4xx `apiError`s go out as they are, plus the request id;
 * - other 4xx (h3's, libraries') get a shared code and a generic message;
 * - **5xx never carry details**: a fixed message, code `INTERNAL`; the cause is logged instead.
 */
export function toErrorResponse(error: unknown, requestId?: string): ErrorResponse {
  const status = isError(error) && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500
  const isServerError = status >= 500
  let data: ApiErrorBody
  if (isServerError) {
    data = { code: ErrorCodes.INTERNAL, message: 'Something went wrong on our side. Please try again.' }
  }
  else if (isError(error) && isApiErrorData(error.data)) {
    data = error.data
  }
  else {
    data = { code: codeForStatus(status), message: GENERIC_MESSAGE[status] ?? 'The request could not be completed.' }
  }
  return {
    status,
    isServerError,
    body: { statusCode: status, message: data.message, data: requestId ? { ...data, requestId } : data },
  }
}
