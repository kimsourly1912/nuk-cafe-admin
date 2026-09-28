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

/** What went wrong, independent of how the server reported it. */
export type ApiErrorKind
  = | 'network' // no response (offline, DNS, CORS preflight blocked)
    | 'timeout'
    | 'aborted' // request cancelled by the app; never shown to users
    | 'unauthorized' // session missing/expired
    | 'forbidden' // logged in but not allowed
    | 'not_found'
    | 'validation' // bad input
    | 'conflict' // stale version, record in use, order changed meanwhile
    | 'business' // another rule rejected the request (the server's message is user-facing)
    | 'rate_limited' // too many attempts (sign-in)
    | 'server' // 5xx / crash
    | 'unknown'

/** Kinds whose server message is meant for users (our API's 4xx messages are user-safe by contract). */
const USER_FACING_KINDS = new Set<ApiErrorKind>(['business', 'validation', 'not_found', 'conflict', 'forbidden', 'rate_limited'])

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
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  server: 'Something went wrong on the server. Please try again.',
  unknown: 'Something went wrong. Please try again.',
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429) return 'rate_limited'
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'validation'
  if (status >= 500) return 'server'
  if (status >= 400) return 'business'
  return 'unknown'
}

/**
 * What a failed request's body says, for both error formats the app meets:
 * - our API (`/api`): `{ statusCode, message, data: { code, message, fieldErrors? } }`
 *   (`ApiErrorBody` in shared/contracts/common.ts);
 * - Better Auth (`/api/auth`): `{ code, message }`.
 */
interface ErrorInfo {
  code?: string
  message?: string
  fieldErrors?: Record<string, string[]>
}

function errorInfoOf(body: unknown): ErrorInfo | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { data } = body as { data?: unknown }
  const source = (typeof data === 'object' && data !== null && 'code' in data ? data : body) as Record<string, unknown>
  const fieldErrors = source.fieldErrors
  return {
    code: typeof source.code === 'string' ? source.code : undefined,
    message: typeof source.message === 'string' && source.message ? source.message : undefined,
    fieldErrors: typeof fieldErrors === 'object' && fieldErrors !== null ? fieldErrors as Record<string, string[]> : undefined,
  }
}

/** A short text from a body that isn't JSON (plain text, a gateway page), for logs. */
function describeBody(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim().slice(0, 300) || undefined
}

interface ApiErrorOptions {
  kind: ApiErrorKind
  /** HTTP status; 0 when there was no response. */
  status: number
  /** Machine-readable code from the server (`VERSION_CONFLICT`, `INVALID_EMAIL_OR_PASSWORD`). */
  code?: string
  /** Raw server/technical message, for logs. Not necessarily user-friendly. */
  detail?: string
  /** Messages per request field path (`name`, `variantGroups.0.name`), for validation errors. */
  fieldErrors?: Record<string, string[]>
  cause?: unknown
}

/**
 * The single error type thrown by the API layer, however the server reported the failure.
 * `message` is always safe to show to users.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly code?: string
  readonly detail?: string
  readonly fieldErrors?: Record<string, string[]>

  constructor(message: string, options: ApiErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
    this.detail = options.detail
    this.fieldErrors = options.fieldErrors
  }

  /** Worth offering a "Retry" button. */
  get retryable() {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server'
  }

  /**
   * Builds an error from an HTTP error response (any body). The server's message is shown for
   * user-facing kinds; 5xx and unknown bodies get a generic message and keep the text as detail.
   */
  static fromResponse(status: number, body: unknown, cause?: unknown): ApiError {
    const kind = kindFromStatus(status)
    const info = errorInfoOf(body)
    const message = info?.message && USER_FACING_KINDS.has(kind) ? info.message : API_ERROR_MESSAGES[kind]
    return new ApiError(message, {
      kind,
      status,
      code: info?.code,
      detail: info?.message ?? describeBody(body),
      fieldErrors: info?.fieldErrors,
      cause,
    })
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
