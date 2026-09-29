import { COUNTER_CHANGE_PASSWORD_PATH, COUNTER_HOME_PATH, COUNTER_SIGN_IN_PATH, isCounterPath, useCounterSession } from '~/features/counter'

/**
 * The counter workspace (`/counter/**`, D102) requires a counter session (branch staff, managers,
 * admins) unless a page declares `definePageMeta({ public: true })` (sign-in). On a temporary
 * password, the change-password page is the only one. Nothing here touches the admin session.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!isCounterPath(to.path)) return

  const { isSignedIn, checked, mustChangePassword, fetchSession } = useCounterSession()
  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    if (to.path === COUNTER_SIGN_IN_PATH && isSignedIn.value) return navigateTo(COUNTER_HOME_PATH)
    return
  }

  if (!isSignedIn.value) return navigateTo({ path: COUNTER_SIGN_IN_PATH, query: { redirect: to.fullPath } })

  if (mustChangePassword.value && to.path !== COUNTER_CHANGE_PASSWORD_PATH) {
    return navigateTo({ path: COUNTER_CHANGE_PASSWORD_PATH, query: to.fullPath === COUNTER_HOME_PATH ? {} : { redirect: to.fullPath } })
  }
})
