// Public API of the menu feature (the customer menu, D93): building blocks other code may use.
// Never export pages or forms from here. Route files import those directly.
// "Opens tomorrow at 7:00 AM", also for the counter's closed banner (D102).
export { openingText } from './utils/opening'
// Order again from an earlier order (the orders feature's page, step 6.5b, D114).
export { useOrderAgain } from './composables/useOrderAgain'
export type { PastLine } from './utils/cart'
