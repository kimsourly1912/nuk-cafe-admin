// Public API of the account feature (the customer's own account, step 5.2, D97). Other code imports
// only from '~/features/account'. The account pages are rendered by their route files.
export { default as AccountButton } from './components/AccountButton.vue'
export { default as VerifyEmailBanner } from './components/VerifyEmailBanner.vue'
// For pages that need the signed-in customer (checkout's sign-in and verify gates, D100).
export { useCustomerAccount, useResendVerification } from './composables/useCustomerAccount'
export { ACCOUNT_PATHS, accountLink } from './utils/account'
