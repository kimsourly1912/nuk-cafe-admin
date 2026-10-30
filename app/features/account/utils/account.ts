import type { ChangePasswordTarget } from '~/utils/account-cafes'
import { ApiError } from '~/utils/api-error'
import { BREACHED_PASSWORD_MESSAGE } from '~/utils/password-requirements'
import { splitTenantUrl, tenantUrl } from '~/utils/tenant-path'

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
 * A cafe's workspaces (D93, D141: `/c/<slug>/admin/…`, `/c/<slug>/counter/…`; the auth and counter
 * features' checks, repeated: the account's header building blocks may not import another feature).
 */
function isWorkspacePath(path: string) {
  const inCafe = splitTenantUrl(path)?.path
  return !!inCafe && /^\/(?:admin|counter)(?:\/|$)/.test(inCafe)
}

/** A page worth coming back to after signing in, else `null` (see `accountRedirectTarget`). */
function returnAddress(redirect: unknown): string | null {
  if (typeof redirect !== 'string' || !redirect.startsWith('/')) return null
  if (redirect.startsWith('//') || redirect.includes('\\')) return null
  const path = redirect.split(/[?#]/)[0]!
  if (path === '/' || isWorkspacePath(path) || NO_RETURN.has(path)) return null
  return redirect
}

/**
 * Where to go after signing in or creating an account: the `?redirect=` target when it's a page of
 * a cafe's customer site (or a table's QR link), else `home` (the menu). Never another site
 * (`//evil.example`, `/\evil.example`), never a workspace (its own sign-in decides that), never
 * back to a sign-in or password page.
 */
export function accountRedirectTarget(redirect: unknown, home: string): string {
  return returnAddress(redirect) ?? home
}

/**
 * A link to an account page that brings the person back afterwards: `/sign-in?redirect=/c/nuk/checkout`.
 * The page is always carried when it's one to come back to: it also says which cafe's menu "Back to
 * the menu" means on the account pages, which have no cafe in their address (D141).
 */
export function accountLink(path: string, from?: unknown) {
  const target = returnAddress(from)
  return target ? { path, query: { redirect: target } } : path
}

/**
 * Where the account pages go back to (D141): the menu of the cafe of the page to come back to, else
 * the platform's own page (`/`). Never a cafe the person didn't come from (D221).
 */
export function accountHome(redirect: unknown): string {
  const slug = typeof redirect === 'string' ? splitTenantUrl(redirect)?.slug : undefined
  return slug ? tenantUrl(slug, '/') : '/'
}

/** The account pages' Back link for `accountHome`'s target: a cafe's menu, or the platform's page. */
export function accountBackLabel(to: string): string {
  return to === '/' ? 'Back to home' : 'Back to the menu'
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
 * A staff account signed in here on its temporary password (Q3, D241): it stays signed in, and the
 * page links to `target`, its workspace's change-password page. The store still counts it as signed
 * out: every route but `/api/auth` refuses it until the password is changed.
 */
export class TemporaryPasswordError extends ApiError {
  constructor(readonly target: ChangePasswordTarget) {
    super('Change your temporary password to continue.', { kind: 'forbidden', status: 403, code: 'PASSWORD_CHANGE_REQUIRED' })
    this.name = 'TemporaryPasswordError'
  }
}

/**
 * Better Auth's answers, in the words of the account pages. Better Auth's 401 for a wrong password
 * isn't a lost session, and it never says which of the two was wrong, so neither do we.
 */
export function accountFormError(error: unknown): AccountFormError {
  if (error instanceof TemporaryPasswordError) {
    return { message: `This account still has a temporary password. Choose a new one in ${error.target.name}, then sign in here.` }
  }
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
      return { field: 'password', message: BREACHED_PASSWORD_MESSAGE }
    case 'PASSWORD_TOO_SHORT':
      return { field: 'password', message: 'At least 8 characters' }
    case 'PASSWORD_TOO_LONG':
      return { field: 'password', message: 'At most 128 characters' }
    // A staff account on its temporary password: the store has no page to change it.
    case 'PASSWORD_CHANGE_REQUIRED':
      return { message: 'This account still has a temporary password. Choose a new one in the cafe\'s admin or counter, then sign in here.' }
  }
  if (apiError.kind === 'rate_limited') return { message: 'Too many tries. Try again in a few minutes.' }
  return { message: apiError.message }
}

/** A link from an email that no longer works (expired, used, or not ours). */
export function isDeadLink(error: unknown) {
  const code = typeof error === 'string' ? error : ApiError.from(error).code
  return code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED'
}
