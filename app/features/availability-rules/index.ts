// Public API of the availability-rules feature: building blocks other features may use.
// Never export pages or forms from here. Route files import those directly.
// The rule picker for the category and menu-item forms is added when those forms move to the
// new API (step 3.8b, part 3).
export { availabilityRulesNavigation } from './navigation'
