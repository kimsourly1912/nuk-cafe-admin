// Public API of the orders feature (the customer's orders, step 6.2b, D100; tracking, 6.5b, D114).
// The order pages are rendered by their route files.
export { formatPickupNumber, tableName } from './utils/order'
// The menu's bar while an order is in progress (mount it only for a signed-in customer).
export { default as ActiveOrdersBar } from './components/ActiveOrdersBar.vue'
