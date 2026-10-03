import { useBroadcastChannel } from '@vueuse/core'
import { isAdminPath, loginPath, loginRedirectTarget, useAuth } from '~/features/auth'

interface AuthMessage {
  event: 'login' | 'logout'
}

/**
 * Login and logout apply to every open tab of the app (they share the auth cookies anyway).
 * Cases: docs/reference/app-behavior.md → "Session loss".
 * - Logged out in another tab: this tab clears its session; the watcher in plugins/api.ts sends it
 *   to /login?redirect=<current page>. No unsaved-changes dialog: staying isn't possible.
 * - Logged in in another tab: a tab waiting on /login continues to its redirect target; a logged-in
 *   tab re-reads the session (it may now be a different staff member).
 * Messages received are never re-sent (only `useAuth().login/logout` fire the hook).
 */
export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuth()
  const router = useRouter()
  const { isSupported, data: message, post } = useBroadcastChannel<AuthMessage, AuthMessage>({ name: 'nuk-cafe-admin:auth' })
  if (!isSupported.value) return

  nuxtApp.hook('app:auth-changed', (event) => {
    post({ event })
  })

  watch(message, async (received) => {
    if (received?.event === 'logout') {
      if (auth.isLoggedIn.value) auth.clearSession()
      return
    }
    // A customer-site tab (outside /admin) never reads the admin session (D93).
    if (received?.event === 'login' && isAdminPath(router.currentRoute.value.path)) {
      await auth.fetchSession()
      const route = router.currentRoute.value
      const slug = splitTenantUrl(route.path)?.slug
      if (slug && auth.isLoggedIn.value && route.path === loginPath(slug)) {
        await nuxtApp.runWithContext(() => navigateTo(loginRedirectTarget(route.query.redirect, slug)))
      }
    }
  })
})
