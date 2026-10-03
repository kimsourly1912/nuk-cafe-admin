// Public API of the cafe feature ("Cafe profile" in the admin, D143; Your cafes and the switcher,
// D144): building blocks other code may use. Never export pages or forms from here. Route files
// import those directly. The cafe's name and logo for every page are the root `useCafe()` and
// `<CafeLogo>`.
export { cafeNavigation } from './navigation'
export { default as CafeSwitcher } from './components/CafeSwitcher.vue'
export { useAccountCafes } from './composables/useAccountCafes'
