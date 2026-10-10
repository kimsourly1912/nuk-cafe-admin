/**
 * A newer build deployed while this tab was open (D149). Nuxt compares its build with the deployed
 * `builds/latest.json` every 5 minutes (`experimental.checkOutdatedBuildInterval`) and calls
 * `app:manifest:update` once it differs. From then on Nuxt's own chunk-reload plugin makes the next
 * route change a full page load (after the route guards, so a dirty form is asked about first).
 * This only records it, for `<NewVersionBanner>` to offer the reload on a page that stays open.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const available = useNewVersion()
  nuxtApp.hook('app:manifest:update', () => {
    available.value = true
  })
})
