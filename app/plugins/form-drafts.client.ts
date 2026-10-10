/**
 * Unsaved input kept in the browser (D151, `useUnsavedChanges({ draft })`). Drafts past their age go
 * when the app starts; signing out on purpose removes every draft on this browser, so nothing typed
 * stays behind on a shared tablet. A session that ended on its own (expiry) keeps them: each is
 * keyed by its person, so only they are offered it.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const store = createFormDraftStore(browserDraftStorage())
  store.purgeExpired()
  nuxtApp.hook('app:auth-changed', (event) => {
    if (event === 'logout') store.removeAll()
  })
})
