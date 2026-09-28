// Public API of the categories feature: building blocks other features may use.
// Never export pages or forms from here. Route files import those directly.
export { default as CategorySelect } from './components/CategorySelect.vue'
export { useCategoryOptions } from './composables/useCategoryOptions'
export { categoriesNavigation } from './navigation'
