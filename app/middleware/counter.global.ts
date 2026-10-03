import { counterChangePasswordPath, counterHomePath, counterSignInPath, isCounterPath, useCounterSession } from '~/features/counter'

/**
 * A cafe's counter workspace (`/c/<slug>/counter/**`, D102, D141) requires a counter session (branch
 * staff, managers, admins) unless a page declares `definePageMeta({ public: true })` (sign-in). On
 * a temporary password, the change-password page is the only one. Nothing here touches the admin
 * session.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const slug = splitTenantUrl(to.path)?.slug
  if (!slug || !isCounterPath(to.path)) return

  const { isSignedIn, checked, mustChangePassword, fetchSession } = useCounterSession()
  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    if (to.path === counterSignInPath(slug) && isSignedIn.value) return navigateTo(counterHomePath(slug))
    return
  }

  if (!isSignedIn.value) return navigateTo({ path: counterSignInPath(slug), query: { redirect: to.fullPath } })

  if (mustChangePassword.value && to.path !== counterChangePasswordPath(slug)) {
    return navigateTo({ path: counterChangePasswordPath(slug), query: to.fullPath === counterHomePath(slug) ? {} : { redirect: to.fullPath } })
  }
})
