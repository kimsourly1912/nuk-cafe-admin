import { CHANGE_PASSWORD_PATH, isAdminPath, LOGIN_PATH, useAuth } from '~/features/auth'

/**
 * The admin workspace (`/admin/**`) requires a valid admin session unless a page declares
 * `definePageMeta({ public: true })` (the login page). On a temporary password, the change-password
 * page is the only one (D52). The customer site (every other path) is public and never reads the
 * admin session (D93).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!isAdminPath(to.path)) return

  const { isLoggedIn, checked, mustChangePassword, fetchSession } = useAuth()

  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    // Logged-in users have no business on the login page.
    if (to.path === LOGIN_PATH && isLoggedIn.value) return navigateTo('/admin')
    return
  }

  if (!isLoggedIn.value) {
    return navigateTo({ path: LOGIN_PATH, query: { redirect: to.fullPath } })
  }

  if (mustChangePassword.value && to.path !== CHANGE_PASSWORD_PATH) {
    return navigateTo({ path: CHANGE_PASSWORD_PATH, query: to.fullPath === '/admin' ? {} : { redirect: to.fullPath } })
  }
})
