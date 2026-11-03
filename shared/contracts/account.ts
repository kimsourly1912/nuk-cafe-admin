import * as v from 'valibot'
import { PASSWORD_MAX } from './identity'

/** `GET /api/account/providers`: current configured providers, never credentials. */
export interface AccountProviders {
  google: boolean
}

/** A staff workspace the account may open: the admin app (D52) or the counter (D102). */
export type Workspace = 'admin' | 'counter'

/**
 * `GET /api/shop/me` for an account: its own details, for the customer site's header and account
 * pages (step 5.2, D97). Ordering doesn't wait for the email to be verified (D156).
 */
export interface CustomerAccount {
  guest: false
  name: string
  email: string
  emailVerified: boolean
  /** Shown to staff at the counter (`XXXX-XXXX`). */
  memberCode: string
  phone: string | null
  marketingOptIn: boolean
  createdAt: string
  /** Links for the account menu, decided on the server; each workspace still checks access itself. */
  workspaces: Workspace[]
}

/**
 * A guest (D156): signed in by Place order, with no email, password or member code. Their orders are
 * theirs on this device; signing in or creating an account moves them to it.
 */
export interface GuestCustomer {
  guest: true
  /** The name they gave for the counter ("Guest" until their first order). */
  name: string
}

/** `GET /api/shop/me`: an account, or a guest. */
export type ShopMe = CustomerAccount | GuestCustomer

/**
 * `POST /api/me/delete-account` (D237): the signed-in account deletes itself, in every cafe, after
 * its password. Its orders stay with the cafes, without its name. Answers 204 and signs out.
 */
export const deleteAccountSchema = v.strictObject({
  password: v.pipe(v.string(), v.minLength(1, 'Enter your password'), v.maxLength(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`)),
})
export type DeleteAccountInput = v.InferOutput<typeof deleteAccountSchema>

/**
 * `POST /api/me/confirm` (D246): the signed-in account's password, so this session may make a
 * dangerous change (payment settings, admin access, owners) for `CONFIRMATION_MS`.
 */
export const confirmIdentitySchema = v.strictObject({
  password: v.pipe(v.string(), v.minLength(1, 'Enter your password'), v.maxLength(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`)),
})
export type ConfirmIdentityInput = v.InferOutput<typeof confirmIdentitySchema>

/** How long a confirmation lasts: dangerous changes within it don't ask again (D246). */
export const CONFIRMATION_MS = 15 * 60_000

/** `POST /api/me/confirm`: until when this session's confirmation lasts. */
export interface IdentityConfirmed {
  confirmedUntil: string
}

/**
 * `GET /api/me/sessions` (D243): where the signed-in account is signed in, newest first, for Your
 * devices on the account security page. No tokens: signing the others out is Better Auth's
 * `/revoke-other-sessions`.
 */
export interface AccountSession {
  id: string
  /** From the browser's user agent: "Chrome on Android", "Safari on iPhone"; "Unknown device". */
  device: string
  /** When this sign-in happened. */
  signedInAt: string
  /** This browser's own session. */
  current: boolean
}
