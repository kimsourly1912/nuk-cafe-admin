/**
 * `GET /api/shop/me`: the signed-in account's own details, for the customer site's header and
 * account pages (step 5.2, D97). Reading works before the email is verified; ordering doesn't (D51).
 */
export interface CustomerAccount {
  name: string
  email: string
  emailVerified: boolean
  /** Shown to staff at the counter (`XXXX-XXXX`). */
  memberCode: string
  phone: string | null
  marketingOptIn: boolean
  createdAt: string
}
