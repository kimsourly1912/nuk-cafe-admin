# Errors

← [API Reference](./README.md)

- [Overview](#overview): how server failures become one error type
- [`ApiError`](#apierror)
- [`getErrorMessage`](#geterrormessage)
- [`isSilentError`](#issilenterror)
- [Error codes](#error-codes): server codes, `API_ERROR_MESSAGES`
- [`<ApiErrorAlert>`](#apierroralert)
- [`useNotify`](#usenotify)
- [Which one do I use?](#which-one-do-i-use)

Source: `app/utils/api-error.ts`, tested in `test/unit/api-error.test.ts`.

---

## Overview

Failures reach the app in a few shapes:

| Failure | How it arrives |
|---|---|
| Our API (`/api/v1`) rejects a request | HTTP 4xx + `{ statusCode, message, data: { code, message, fieldErrors? } }` ([API → Errors](./api.md#errors)) |
| Better Auth rejects a sign-in | HTTP 4xx + `{ code, message }` (`INVALID_EMAIL_OR_PASSWORD`, rate limiting) |
| Crash, gateway, proxy | HTTP 5xx, possibly plain text or HTML |
| Offline, DNS, timeout | No response at all |

`apiFetch` turns **all of them** into a single [`ApiError`](#apierror) with a `kind` and a message that's always safe to show. Feature code never inspects HTTP status codes.

---

## `ApiError`

```ts
class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number       // HTTP status; 0 = no response
  readonly code?: string        // server code, e.g. 'VERSION_CONFLICT'
  readonly fieldErrors?: Record<string, string[]> // per request field, for validation
  readonly message: string      // ALWAYS safe to show to users
  readonly detail?: string      // raw technical text, for logs only
  get retryable(): boolean      // network | timeout | server

  static from(error: unknown): ApiError
  static fromResponse(status: number, body: unknown, cause?: unknown): ApiError
}
```

### `kind`

| Kind | Meaning | Message shown |
|---|---|---|
| `validation` | Bad input (HTTP 400, 413, 415, 422) | Server message, e.g. "Some of the submitted data is invalid." (details in `fieldErrors`) |
| `not_found` | Item doesn't exist (HTTP 404) | Server message, e.g. "The category was not found. It may have been deleted." |
| `conflict` | HTTP 409: stale `version`, record in use, order changed meanwhile | Server message, e.g. "This category was changed by someone else. Reload it and try again." |
| `forbidden` | HTTP 403: not an admin (`NOT_ADMIN`, which also ends the session), a temporary password (`PASSWORD_CHANGE_REQUIRED`, which opens the change-password page), missing permission, cross-origin write | Server message, or "You don't have permission to do this." |
| `business` | Other 4xx | Server message, or "The request could not be completed." |
| `rate_limited` | HTTP 429 (sign-in attempts) | Server message, or "Too many attempts. Wait a moment and try again." |
| `unauthorized` | No session (HTTP 401). Ends the session: the user goes to login | "Your session has expired…" (usually never shown) |
| `server` | HTTP 5xx, gateway pages | "Something went wrong on the server. Please try again." (the server text is kept as `detail` only) |
| `network` | No response (offline, DNS) | "Can't reach the server. Check your connection and try again." |
| `timeout` | No response within 30s, or HTTP 408/504 | "The server took too long to respond. Please try again." |
| `aborted` | Cancelled by the app, or a response from a previous identity | Never shown |
| `unknown` | Unexpected JS errors | "Something went wrong. Please try again." |

Branch on `kind`, or on `code` for a specific reason (`error.code === 'SCHEDULE_IN_USE'`).

### `ApiError.from(error)`

Normalizes **anything** thrown into an `ApiError`: an `ApiError` (returned as-is), ofetch errors, `useAsyncData`'s NuxtError wrapper, `AbortError`/`TimeoutError`, fetch `TypeError`s, and plain `Error`s.

```ts
catch (e) {
  const error = ApiError.from(e)
  if (error.kind === 'not_found') return navigateTo('/categories')
}
```

- It walks the whole `cause` chain. NuxtError wrappers drop the original `ApiError`, so the chain is the only way to recover it.
- A programming error (`TypeError: Cannot read properties of undefined`) becomes `unknown` with a generic message. It's never shown as-is and never mistaken for a network error.

### `ApiError.fromResponse(status, body)`

Builds an error from any HTTP status and body. You won't normally call it; the API layer does. It's useful in tests.

```ts
ApiError.fromResponse(404, { statusCode: 404, message: 'Category not found', data: { code: 'NOT_FOUND', message: 'Category not found' } })
// → kind 'not_found', code 'NOT_FOUND', message 'Category not found'
```

### `retryable`

`true` for `network`, `timeout` and `server`: worth offering a Retry.

---

## `getErrorMessage`

```ts
function getErrorMessage(error: unknown): string // = ApiError.from(error).message
```

For inline messages outside toasts:

```ts
catch (e) { formError.value = getErrorMessage(e) }
```

## `isSilentError`

```ts
function isSilentError(error: ApiError): boolean // kind is 'aborted' or 'unauthorized'
```

Errors that must not produce a toast: cancelled on purpose, or already handled by the session redirect. `useMutation` and `useNotify` apply this automatically.

---

## Error codes

The server's codes are listed in `ERROR_CODES` (`shared/contracts/common.ts`) and explained in [API → Errors](./api.md#errors). The client doesn't map codes to kinds: the HTTP status decides the kind, and 4xx messages are written to be shown. Add a code to `ERROR_CODES` and to the API page when a route needs a new one.

`API_ERROR_MESSAGES: Record<ApiErrorKind, string>` holds the fallback messages from the table above.

---

## `<ApiErrorAlert>`

Inline alert for a **failed load**, with a Retry button.

Source: `app/components/ApiErrorAlert.vue`

```vue
<ApiErrorAlert v-if="error" :error="error" title="Could not load categories" @retry="refresh()" />
```

| Prop / event | Type | Default | Description |
|---|---|---|---|
| `error` | `unknown` | **required** | Anything. It's normalized with `ApiError.from`, so passing `useApiQuery`'s `error` is fine. |
| `title` | `string` | `'Could not load data'` | Alert title. The description is the error message. |
| `@retry` | `() => void` | none | Clicked Retry. Usually `refresh()`. |

---

## `useNotify`

Success, warning and error toasts for API actions that **aren't** mutations (exports, lookups, one-off actions). Create/update/delete should use [`useMutation`](./mutations.md), which toasts by itself.

Source: `app/composables/useNotify.ts`

```ts
const notify = useNotify()
try {
  await apiFetch('/staff/vouchers/lookup', { method: 'POST', body: { voucherCode } })
  notify.success('Voucher is valid')
}
catch (error) {
  notify.error('Could not look up voucher', error) // description = user-safe message
}
```

| Method | Description |
|---|---|
| `success(title, description?)` | Green toast. |
| `warning(title, description?)` | Amber toast that **stays until dismissed**: the action worked but needs a look. |
| `error(title, error)` | Red toast with `ApiError.from(error).message`. It does nothing for [silent errors](#issilenterror), and logs `detail` to the console in dev. |

---

## Which one do I use?

| Situation | Use |
|---|---|
| Create / update / delete | [`useMutation`](./mutations.md): errors are toasted and recorded per item |
| A list or detail failed to load | `<ApiErrorAlert :error="error" @retry="refresh()" />` |
| Inline error in a form (e.g. login) | `getErrorMessage(e)` in a `UAlert` |
| Another one-off API action | `useNotify()` |
| Branch on what went wrong | `ApiError.from(e).kind === '…'`. Never compare status codes or message strings |
| Anything else uncaught | `plugins/errors.ts` toasts it as a safety net. Don't rely on it |

**Never** show `error.message` from something that isn't an `ApiError`, and never use `useToast()` directly for API results.
