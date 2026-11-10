import { isPlatformPath, PLATFORM_CHANGE_PASSWORD, PLATFORM_HOME, PLATFORM_SIGN_IN, platformRedirectTarget, PLATFORM_TWO_FACTOR, usePlatformSession } from '~/features/platform'

/**
 * The platform console (`/platform/**`, D142) requires a super admin's session unless a page
 * declares `definePageMeta({ public: true })` (sign-in). On a temporary password, the
 * change-password page is the only one; then, until two-step sign-in is set up (D188), its setup.
 * Nothing here touches a cafe's admin or counter session.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (useError().value && (import.meta.server || useNuxtApp().isHydrating)) return
  if (!isPlatformPath(to.path)) return

  const { isSignedIn, checked, mustChangePassword, twoFactorEnabled, sessionError, fetchSession, signingOut } = usePlatformSession()
  if (!checked.value && !sessionError.value) await fetchSession()

  if (to.meta.public) {
    if (to.path === PLATFORM_SIGN_IN && isSignedIn.value && !signingOut.value) return navigateTo(platformRedirectTarget(to.query.redirect), { replace: true })
    return
  }

  if (!isSignedIn.value) return navigateTo({ path: PLATFORM_SIGN_IN, query: { redirect: to.fullPath } })

  if (mustChangePassword.value && to.path !== PLATFORM_CHANGE_PASSWORD) {
    return navigateTo({ path: PLATFORM_CHANGE_PASSWORD, query: to.fullPath === PLATFORM_HOME ? {} : { redirect: to.fullPath } })
  }

  if (!mustChangePassword.value && !twoFactorEnabled.value && to.path !== PLATFORM_TWO_FACTOR) {
    return navigateTo({ path: PLATFORM_TWO_FACTOR, query: to.fullPath === PLATFORM_HOME ? {} : { redirect: to.fullPath } })
  }
})
