import { CHANGE_PASSWORD_PATH, useAuth } from '~/features/auth'

/**
 * Every page requires a valid session unless it declares `definePageMeta({ public: true })`.
 * On a temporary password, the change-password page is the only one (D52).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { isLoggedIn, checked, mustChangePassword, fetchSession } = useAuth()

  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    // Logged-in users have no business on the login page.
    if (to.path === '/login' && isLoggedIn.value) return navigateTo('/')
    return
  }

  if (!isLoggedIn.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }

  if (mustChangePassword.value && to.path !== CHANGE_PASSWORD_PATH) {
    return navigateTo({ path: CHANGE_PASSWORD_PATH, query: to.fullPath === '/' ? {} : { redirect: to.fullPath } })
  }
})
