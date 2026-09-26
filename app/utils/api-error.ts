import { FetchError } from 'ofetch'

/** Shape every backend response is wrapped in (`ResponseMsg*` in the generated types). */
export interface ApiEnvelope<T = unknown> {
  data?: T
  success?: boolean
  /** Machine-readable code, e.g. `NC1000`, `LOGIN_FAILED`. */
  msg?: string
  /** Human-readable message. */
  reason?: string
}

export function isApiEnvelope(value: unknown): value is ApiEnvelope {
  return typeof value === 'object' && value !== null && 'success' in value
}

/**
 * The single error type thrown by the API layer. Covers both HTTP errors (4xx/5xx)
 * and HTTP 200 responses with `success: false` (the backend does this, e.g. on bad login).
 */
export class ApiError extends Error {
  /** HTTP status; 200 when the backend returned `success: false` with a 200. */
  readonly status: number
  /** Backend code from `msg`, e.g. `NC1000`. */
  readonly code?: string

  constructor(message: string, options: { status: number, code?: string, cause?: unknown }) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
  }

  static fromEnvelope(envelope: ApiEnvelope, status: number, cause?: unknown) {
    return new ApiError(envelope.reason || envelope.msg || 'Request failed', {
      status,
      code: envelope.msg,
      cause,
    })
  }

  static from(error: unknown): ApiError {
    if (error instanceof ApiError) return error
    if (error instanceof FetchError) {
      const status = error.statusCode ?? 0
      if (isApiEnvelope(error.data)) return ApiError.fromEnvelope(error.data, status, error)
      return new ApiError(status ? error.statusMessage || error.message : 'Network error', { status, cause: error })
    }
    return new ApiError(error instanceof Error ? error.message : 'Unexpected error', { status: 0, cause: error })
  }
}

/** Human-readable message for any error, for toasts and inline alerts. */
export function getErrorMessage(error: unknown): string {
  return ApiError.from(error).message
}
