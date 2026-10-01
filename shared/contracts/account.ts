/**
 * `GET /api/shop/me`: the signed-in account's own details, for the customer site's header and
 * account pages (step 5.2, D97). Reading works before the email is verified; ordering doesn't (D51).
 */
/** A staff workspace the account may open: the admin app (D52) or the counter (D102). */
export type Workspace = 'admin' | 'counter'

export interface CustomerAccount {
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
