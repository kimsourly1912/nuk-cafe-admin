# Errors

← [API Reference](./README.md)

- [Overview](#overview): how backend failures become one error type
- [`ApiError`](#apierror)
- [`getErrorMessage`](#geterrormessage)
- [`isSilentError`](#issilenterror)
- [Error codes](#error-codes): `API_ERROR_CODES`, `API_ERROR_MESSAGES`
- [`<ApiErrorAlert>`](#apierroralert)
- [`useNotify`](#usenotify)
- [Which one do I use?](#which-one-do-i-use)

Source: `app/utils/api-error.ts`, tested in `test/unit/api-error.test.ts`.

---

## Overview

The backend reports failures inconsistently:

| Failure | How it arrives |
|---|---|
| Validation, not found, wrong login, "unknown path" | **HTTP 200** + `{ success: false, msg: 'NC0001', reason: '…' }` |
| Session expired | HTTP 401 + envelope (`NC1000`) |
| Gateway, CORS, crash | Real HTTP 4xx/5xx, possibly plain text, HTML or Spring's default JSON |
| Offline, DNS, timeout | No response at all |

The API layer turns **all of them** into a single [`ApiError`](#apierror) with a `kind` and a message that's always safe to show. Feature code never checks `success` or HTTP status codes.

---

## `ApiError`

```ts
class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number       // HTTP status; 0 = no response; 200 = success:false
  readonly code?: string        // backend `msg`, e.g. 'NC0001'
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
| `validation` | Bad input (`NC0001`, HTTP 400/422) | Backend `reason`, e.g. "Required fields are missing: password, username" |
| `not_found` | Item doesn't exist (`NC0011`, `NC0014`, HTTP 404) | Backend `reason`, e.g. "Category not found" |
| `business` | A domain rule rejected it (unknown codes sent with HTTP 200, `LOGIN_FAILED`) | Backend `reason`, e.g. "Incorrect username or password" |
| `conflict` | HTTP 409 | Backend `reason`, or "This change conflicts with existing data." |
| `forbidden` | Logged in but not allowed (HTTP 403) | Backend `reason`, or "You don't have permission to do this." |
| `unauthorized` | Session missing or expired (`NC1000`, HTTP 401). Triggers the token refresh | "Your session has expired…" (usually never shown: the user is redirected) |
| `server` | HTTP 5xx, gateway pages | "Something went wrong on the server. Please try again." |
| `network` | No response (offline, DNS) | "Can't reach the server. Check your connection and try again." |
| `timeout` | No response within 30s, or HTTP 408/504 | "The server took too long to respond. Please try again." |
| `aborted` | Cancelled by the app | Never shown |
| `unknown` | Technical backend errors (`NC0000`), unexpected JS errors | "Something went wrong. Please try again." |

**The backend code wins over the HTTP status.** `NC1000` sent with HTTP 200 is still `unauthorized` and still triggers the refresh.

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
ApiError.fromResponse(200, { success: false, msg: 'NC0011', reason: 'Category not found' })
// → kind 'not_found', message 'Category not found'
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

```ts
const API_ERROR_CODES: Record<string, ApiErrorKind> = {
  NC0000: 'unknown',      // generic handler: reason is a raw technical message (hidden)
  NC0001: 'validation',
  NC0011: 'not_found',    // category not found
  NC0014: 'not_found',    // product not found
  NC1000: 'unauthorized',
  LOGIN_FAILED: 'business',
}
```

**When you meet a new backend code, add it here.** Unknown codes sent with HTTP 200 fall back to `business` and show their `reason`. That's right for domain messages, but wrong for technical ones: add those as `unknown` to hide them.

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

Success and error toasts for API actions that **aren't** mutations (exports, lookups, one-off actions). Create/update/delete should use [`useMutation`](./mutations.md), which toasts by itself.

Source: `app/composables/useNotify.ts`

```ts
const notify = useNotify()
try {
  await unwrap(lookup({ body: { voucherCode } }))
  notify.success('Voucher is valid')
}
catch (error) {
  notify.error('Could not look up voucher', error) // description = user-safe message
}
```

| Method | Description |
|---|---|
| `success(title, description?)` | Green toast. |
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
