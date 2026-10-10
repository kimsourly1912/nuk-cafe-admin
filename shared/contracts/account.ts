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
