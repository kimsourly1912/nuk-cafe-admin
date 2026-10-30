import { counterChangePasswordPath, counterHomePath, counterSignInPath, isCounterPath, useCounterSession } from '~/features/counter'
import { PAGE_FORBIDDEN } from '~/features/errors'

/**
 * A cafe's counter workspace (`/c/<slug>/counter/**`, D102, D141) requires a counter session (branch
 * staff, managers, admins) unless a page declares `definePageMeta({ public: true })` (sign-in). On
 * a temporary password, the change-password page is the only one. A page with `branchPermission`
 * in its meta opens only where the session has it at the branch in the path (D240). Nothing here
 * touches the admin session.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const slug = splitTenantUrl(to.path)?.slug
  if (!slug || !isCounterPath(to.path)) return

  const { user, isSignedIn, checked, mustChangePassword, fetchSession, can } = useCounterSession()
  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    if (to.path === counterSignInPath(slug) && isSignedIn.value) return navigateTo(counterHomePath(slug))
    return
  }

  if (!isSignedIn.value) return navigateTo({ path: counterSignInPath(slug), query: { redirect: to.fullPath } })

  if (mustChangePassword.value && to.path !== counterChangePasswordPath(slug)) {
    return navigateTo({ path: counterChangePasswordPath(slug), query: to.fullPath === counterHomePath(slug) ? {} : { redirect: to.fullPath } })
  }

  // A manager's page opened by staff (Dining tables, Reports, D198): the refusal page before anything
  // loads. A branch the session doesn't list (another person's, or one added since) is the server's
  // to answer: its 404 is the page's own error.
  const branchId = String(to.params.branchId ?? '')
  const permission = to.meta.branchPermission
  const knownBranch = user.value?.branches.some(branch => branch.id === branchId)
  if (permission && knownBranch && !can(branchId, permission)) {
    return abortNavigation(createError({ status: 403, statusText: 'No access to this page', data: { code: PAGE_FORBIDDEN }, fatal: true }))
  }
})
