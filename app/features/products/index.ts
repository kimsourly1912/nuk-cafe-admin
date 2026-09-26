// Public API of the products feature ("Menu items" in the UI): building blocks other features may
// use. Never export pages or forms from here. Route files import those directly.
// A ProductSelect comes with its first consumer (docs/plans/products.md → Relationships).
export { productsNavigation } from './navigation'
