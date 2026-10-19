// Public API of the support feature ("Platform support" in the admin, P5, D193): building blocks
// other code may use. Never export pages from here: route files import those directly.
export { supportNavigation } from './navigation'
export { default as SupportBanner } from './components/SupportBanner.vue'
