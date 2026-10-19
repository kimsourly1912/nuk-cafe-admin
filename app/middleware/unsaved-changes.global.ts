import { useAuth } from '~/features/auth'
import { usePlatformSession } from '~/features/platform'

/**
 * Ask before leaving a page while a form has unsaved changes: links, `navigateTo`, back/forward,
 * and param changes on the same page. On "Discard" every open form is discarded (modals close).
 * Runs after `auth.global.ts` (global middleware run in file name order). The platform console has
 * its own session (D142): its page forms (Create a cafe, D185) are asked about too.
 */
export default defineNuxtRouteMiddleware(async () => {
  // Session lost: the redirect to login is forced, so there is nothing to ask.
  if (!useAuth().isLoggedIn.value && !usePlatformSession().isSignedIn.value) return

  if (!await useLeaveGuard().confirmLeave()) return abortNavigation()
})
