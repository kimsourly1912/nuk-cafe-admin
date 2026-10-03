import { isPlatformPath, PLATFORM_CHANGE_PASSWORD, PLATFORM_HOME, PLATFORM_SIGN_IN, usePlatformSession } from '~/features/platform'

/**
 * The platform console (`/platform/**`, D142) requires a super admin's session unless a page
 * declares `definePageMeta({ public: true })` (sign-in). On a temporary password, the
 * change-password page is the only one. Nothing here touches a cafe's admin or counter session.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!isPlatformPath(to.path)) return

  const { isSignedIn, checked, mustChangePassword, fetchSession } = usePlatformSession()
  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    if (to.path === PLATFORM_SIGN_IN && isSignedIn.value) return navigateTo(PLATFORM_HOME)
    return
  }

  if (!isSignedIn.value) return navigateTo({ path: PLATFORM_SIGN_IN, query: { redirect: to.fullPath } })

  if (mustChangePassword.value && to.path !== PLATFORM_CHANGE_PASSWORD) {
    return navigateTo({ path: PLATFORM_CHANGE_PASSWORD, query: to.fullPath === PLATFORM_HOME ? {} : { redirect: to.fullPath } })
  }
})
