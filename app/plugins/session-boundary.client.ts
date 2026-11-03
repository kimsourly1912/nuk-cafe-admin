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
import { useAuth } from '~/features/auth'
import { useCounterSession } from '~/features/counter'
import { usePlatformSession } from '~/features/platform'

export default defineNuxtPlugin((nuxtApp) => {
  const overlay = useOverlay()
  const toast = useToast()
  const auth = useAuth()
  const counter = useCounterSession()
  const platform = usePlatformSession()

  nuxtApp.hook('app:session-changed', ({ signedIn, source }) => nuxtApp.runWithContext(() => {
    if (source !== 'admin') auth.resetSession(!signedIn)
    if (source !== 'counter') counter.resetSession(!signedIn)
    if (source !== 'platform') platform.resetSession(!signedIn)
    useLeaveGuard().discardAll()
    overlay.closeAll()
    toast.clear()
    resetMutationOutcomes()

    // These three reads are public and identical for every identity. Clearing them emptied the
    // menu after public sign-out/erasure, when protected queries deliberately do not refetch.
    const publicKey = (key: string) => key.startsWith('cafe:profile:') || key === 'menu:branches' || key.startsWith('menu:public:')
    const keys = Object.keys(nuxtApp.payload.data).filter(key => /^[\w-]+:/.test(key) && !publicKey(key))
    if (!keys.length) return
    clearNuxtData(keys)
    // Await only the small deciding account reads. Other sections refresh independently, and a
    // signed-out workspace never restarts its protected reads while navigating away.
    const accounts = keys.filter(key => key.startsWith('account:'))
    const sections = keys.filter(key => !key.startsWith('account:'))
    if (signedIn && sections.length) void refreshNuxtData(sections)
    if (accounts.length) return refreshNuxtData(accounts)
  }))
})
