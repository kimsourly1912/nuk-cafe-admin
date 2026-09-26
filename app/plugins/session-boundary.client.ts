/**
 * The frontend session-transition contract. On every identity change (login, logout, expiry,
 * account change in this or another tab; `useAuth` fires `app:session-changed`), nothing from
 * the previous identity may show up in the next one:
 *
 * 1. In-flight responses: discarded by the API layer (the identity generation changed).
 * 2. Unsaved forms: discarded **without asking** (staying isn't possible). A voluntary logout has
 *    already asked before it got here (`useAuth().logout` → `confirmLeave`).
 * 3. Open overlays (form modals, confirmations, shortcut help) close; toasts are cleared, which
 *    also drops "Reopen" drafts and batch results of the previous identity.
 * 4. Mutation outcomes (errors, "removed" marks, last results) reset. In-flight calls and record
 *    locks stay until their (discarded) requests settle.
 * 5. API query data (`<feature>:` keys) is cleared. If someone is signed in, loaded queries
 *    refetch for the new identity; signed out, nothing refetches (the app goes to /login).
 *
 * Cases and tests: docs/reference/app-behavior.md → "Session loss", test/e2e/session.test.ts.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const overlay = useOverlay()
  const toast = useToast()

  nuxtApp.hook('app:session-changed', ({ signedIn }) => nuxtApp.runWithContext(() => {
    useLeaveGuard().discardAll()
    overlay.closeAll()
    toast.clear()
    resetMutationOutcomes()

    const keys = Object.keys(nuxtApp.payload.data).filter(key => /^[\w-]+:/.test(key))
    if (!keys.length) return
    clearNuxtData(keys)
    if (signedIn) void refreshNuxtData(keys)
  }))
})
