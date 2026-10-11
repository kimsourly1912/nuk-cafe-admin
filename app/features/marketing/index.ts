// Public API of the marketing feature (M2a, D164): building blocks other features may use.
// Never export pages or forms from here. Route files import those directly.
export { marketingNavigation } from './navigation'
export { useMarketingChannels } from './composables/useMarketingChannels'
