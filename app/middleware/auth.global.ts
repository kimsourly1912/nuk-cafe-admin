import { useAuth } from '~/features/auth'

/**
 * Every page requires a valid session unless it declares `definePageMeta({ public: true })`.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { isLoggedIn, checked, fetchSession } = useAuth()

  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    // Logged-in users have no business on the login page.
    if (to.path === '/login' && isLoggedIn.value) return navigateTo('/')
    return
  }

  if (!isLoggedIn.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
