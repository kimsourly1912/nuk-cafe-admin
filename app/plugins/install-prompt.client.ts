/**
 * Chrome and Edge announce that the site can be installed with `beforeinstallprompt`, usually
 * while the page loads, before the user menu exists. Kept for "Install app" (D203); its default
 * (the browser's own mini prompt) is held back so the app offers it from the menu instead.
 */
export default defineNuxtPlugin(() => {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    keepInstallPrompt(event)
  })
  window.addEventListener('appinstalled', () => keepInstallPrompt(null))
})
