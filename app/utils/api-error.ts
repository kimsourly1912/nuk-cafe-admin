import type { FetchError } from 'ofetch'

/**
 * Duck-typed: `instanceof FetchError` is unreliable because Vite can load separate copies
 * of ofetch (app code vs pre-bundled deps), each with its own class.
 */
function isFetchError(error: unknown): error is FetchError {
  return error instanceof Error && error.name === 'FetchError'
}

/** fetch() rejects with a TypeError on network failure; the message differs per browser. */
const NETWORK_ERROR_MESSAGES = ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'fetch failed']

function isNetworkTypeError(error: Error) {
  return error instanceof TypeError && NETWORK_ERROR_MESSAGES.some(m => error.message.startsWith(m))
}

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

/** What went wrong, independent of how the backend reported it. */
export type ApiErrorKind
  = | 'network' // no response (offline, DNS, CORS preflight blocked)
    | 'timeout'
    | 'aborted' // request cancelled by the app; never shown to users
    | 'unauthorized' // session missing/expired
    | 'forbidden' // logged in but not allowed
    | 'not_found'
    | 'validation' // bad input
    | 'conflict'
    | 'business' // domain rule rejected the request (backend reason is user-facing)
    | 'server' // 5xx / crash
    | 'unknown'

/**
 * Known backend codes (`msg`). The backend mostly answers HTTP 200 + `success: false`,
 * so the code, not the status, is what tells errors apart. Add codes here as you meet them.
 */
export const API_ERROR_CODES: Record<string, ApiErrorKind> = {
  NC0000: 'unknown', // generic exception handler: reason is a raw technical message
  NC0001: 'validation', // malformed body, missing fields, invalid param
  NC0011: 'not_found', // category not found
  NC0014: 'not_found', // product not found
  NC1000: 'unauthorized',
  LOGIN_FAILED: 'business', // wrong credentials: reason is user-facing
}

/** Codes whose `reason` is technical and must not be shown to users. */
const TECHNICAL_CODES = new Set(['NC0000'])

/** Kinds whose backend `reason` is meant for users. */
const USER_FACING_KINDS = new Set<ApiErrorKind>(['business', 'validation', 'not_found', 'conflict', 'forbidden'])

export const API_ERROR_MESSAGES: Record<ApiErrorKind, string> = {
  network: 'Can\'t reach the server. Check your connection and try again.',
  timeout: 'The server took too long to respond. Please try again.',
  aborted: 'The request was cancelled.',
  unauthorized: 'Your session has expired. Please sign in again.',
  forbidden: 'You don\'t have permission to do this.',
  not_found: 'The requested item was not found.',
  validation: 'Some of the submitted data is invalid.',
  conflict: 'This change conflicts with existing data.',
  business: 'The request could not be completed.',
  server: 'Something went wrong on the server. Please try again.',
  unknown: 'Something went wrong. Please try again.',
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 400 || status === 422) return 'validation'
  if (status >= 500) return 'server'
  // HTTP 2xx with success: false: a rejection with no better signal.
  if (status >= 200 && status < 300) return 'business'
  return 'unknown'
}

/** Extracts a message from bodies that aren't the envelope (Spring default error JSON, plain text). */
function describeBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim().slice(0, 300) || undefined
  if (typeof body === 'object' && body !== null) {
    const { message, error } = body as { message?: unknown, error?: unknown }
    if (typeof message === 'string' && message) return message
    if (typeof error === 'string' && error) return error
  }
}

interface ApiErrorOptions {
  kind: ApiErrorKind
  /** HTTP status; 0 when there was no response. 200 when the backend sent `success: false`. */
  status: number
  /** Backend code from `msg`. */
  code?: string
  /** Raw backend/technical message, for logs. Not necessarily user-friendly. */
  detail?: string
  cause?: unknown
}

/**
 * The single error type thrown by the API layer, however the backend reported the failure.
 * `message` is always safe to show to users.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly code?: string
  readonly detail?: string

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
    this.detail = options.detail
  }

  /** Worth offering a "Retry" button. */
  get retryable() {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server'
  }

  /** Builds an error from an HTTP response (any status, any body). */
  static fromResponse(status: number, body: unknown, cause?: unknown): ApiError {
    if (isApiEnvelope(body)) {
      const code = body.msg
      const kind = (code && API_ERROR_CODES[code]) || kindFromStatus(status)
      const reason = body.reason?.trim()
      const showReason = reason && USER_FACING_KINDS.has(kind) && !(code && TECHNICAL_CODES.has(code))
      return new ApiError(showReason ? reason : API_ERROR_MESSAGES[kind], { kind, status, code, detail: reason, cause })
    }
    const kind = kindFromStatus(status)
    return new ApiError(API_ERROR_MESSAGES[kind], { kind, status, detail: describeBody(body), cause })
  }

  /**
   * Normalizes anything thrown to ApiError. Walks the `cause` chain because wrappers hide the
   * original: useAsyncData's NuxtError (h3 `createError`) takes the ApiError's *own* cause
   * (e.g. the raw TypeError), so the ApiError itself may no longer be in the chain.
   */
  static from(error: unknown): ApiError {
    for (let e: unknown = error, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
      if (e instanceof ApiError) return e
      if (isFetchError(e)) {
        if (e.response) return ApiError.fromResponse(e.response.status, e.data, e)
        return ApiError.fromNoResponse(e.cause ?? e)
      }
      if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError' || isNetworkTypeError(e))) {
        return ApiError.fromNoResponse(e)
      }
    }

    const detail = error instanceof Error ? error.message : String(error)
    return new ApiError(API_ERROR_MESSAGES.unknown, { kind: 'unknown', status: 0, detail, cause: error })
  }

  private static fromNoResponse(cause: unknown): ApiError {
    const name = cause instanceof Error ? cause.name : ''
    const kind: ApiErrorKind = name === 'TimeoutError' ? 'timeout' : name === 'AbortError' ? 'aborted' : 'network'
    const detail = cause instanceof Error ? cause.message : undefined
    return new ApiError(API_ERROR_MESSAGES[kind], { kind, status: 0, detail, cause })
  }
}

/** Errors that must not produce a toast: cancelled on purpose, or handled by the session redirect. */
export function isSilentError(error: ApiError) {
  return error.kind === 'aborted' || error.kind === 'unauthorized'
}

/** User-safe message for any error, for toasts and inline alerts. */
export function getErrorMessage(error: unknown): string {
  return ApiError.from(error).message
}
