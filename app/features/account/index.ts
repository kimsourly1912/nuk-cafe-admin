// Public API of the account feature (the customer's own account, step 5.2, D97). Other code imports
// only from '~/features/account'. The account pages are rendered by their route files.
export { default as AccountButton } from './components/AccountButton.vue'
export { default as VerifyEmailBanner } from './components/VerifyEmailBanner.vue'
// The cafe's logo and name on the account layout's phone bar (D143).
export { default as AccountBrand } from './components/AccountBrand.vue'
// For pages that need the signed-in customer, and Place order signing in a guest (D100, D156).
export { useAccountActions, useCustomerAccount, useResendVerification } from './composables/useCustomerAccount'
// Who is signed in, without any cafe's profile: the platform's pages, `/` included (D221).
export { useAccountSession } from './composables/useCustomerAccount'
export type { AccountIdentity } from './composables/useCustomerAccount'
// The menu the platform's account pages go back to (their layout's logo, D141).
export { useAccountHome } from './composables/useAccountHome'
export { ACCOUNT_PATHS, accountLink, initialsOf } from './utils/account'
