import { ApiError } from '~/utils/api-error'

/** The customer's account pages (step 5.2, D97). */
export const ACCOUNT_PATHS = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  verifyEmail: '/verify-email',
  emailVerified: '/email-verified',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
} as const

/** Pages that make no sense to come back to after signing in (the email pages do). */
const NO_RETURN = new Set<string>([ACCOUNT_PATHS.signIn, ACCOUNT_PATHS.signUp, ACCOUNT_PATHS.forgotPassword, ACCOUNT_PATHS.resetPassword])

/**
 * The admin workspace's paths (D93; the auth feature's `isAdminPath`, repeated: the account's
 * header building blocks may not import another feature).
 */
const isAdminPath = (path: string) => path === '/admin' || path.startsWith('/admin/')

/**
 * Where to go after signing in or creating an account: the `?redirect=` target when it's a page of
 * the customer site, else the menu. Never another site (`//evil.example`, `/\evil.example`), never
 * the admin (its own sign-in decides that), never back to a sign-in or password page.
 */
export function accountRedirectTarget(redirect: unknown): string {
  if (typeof redirect !== 'string' || !redirect.startsWith('/')) return '/'
  if (redirect.startsWith('//') || redirect.includes('\\')) return '/'
  const path = redirect.split(/[?#]/)[0]!
  if (isAdminPath(path) || NO_RETURN.has(path)) return '/'
  return redirect
}

/**
 * A link to an account page that brings the person back afterwards: `/sign-in?redirect=/table/…`.
 * Only a customer-site page is carried (the menu, the default, stays out of the URL).
 */
export function accountLink(path: string, from?: unknown) {
  const target = accountRedirectTarget(from)
  return target === '/' ? path : { path, query: { redirect: target } }
}

/** "SC" for "Sokha Chan", "S" for "Sokha", the email's first letter without a name. */
export function initialsOf(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [words[0]?.[0] ?? email[0]]
  return letters.join('').toUpperCase()
}

export type AccountField = 'name' | 'email' | 'password'

/** An error for the form: on one field, or (no `field`) in the alert above the fields. */
export interface AccountFormError {
  field?: AccountField
  message: string
}

/**
 * Better Auth's answers, in the words of the account pages. Better Auth's 401 for a wrong password
 * isn't a lost session, and it never says which of the two was wrong, so neither do we.
 */
export function accountFormError(error: unknown): AccountFormError {
  const apiError = ApiError.from(error)
  switch (apiError.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return { message: 'Wrong email or password.' }
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return { field: 'email', message: 'An account with this email already exists. Sign in instead.' }
    case 'INVALID_EMAIL':
      return { field: 'email', message: 'Enter a valid email address' }
    case 'PASSWORD_COMPROMISED':
      return { field: 'password', message: 'This password has appeared in a data breach. Choose another one.' }
    case 'PASSWORD_TOO_SHORT':
      return { field: 'password', message: 'At least 8 characters' }
    case 'PASSWORD_TOO_LONG':
      return { field: 'password', message: 'At most 128 characters' }
  }
  if (apiError.kind === 'rate_limited') return { message: 'Too many tries. Try again in a few minutes.' }
  return { message: apiError.message }
}

/** A link from an email that no longer works (expired, used, or not ours). */
export function isDeadLink(error: unknown) {
  const code = typeof error === 'string' ? error : ApiError.from(error).code
  return code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED'
}
