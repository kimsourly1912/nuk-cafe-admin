import { adminHomePath, changePasswordPath, isAdminPath, loginPath, useAuth } from '~/features/auth'
import { PAGE_FORBIDDEN } from '~/features/errors'

/**
 * A cafe's admin workspace (`/c/<slug>/admin/**`) requires a valid admin session unless a page
 * declares `definePageMeta({ public: true })` (the login page). On a temporary password, the
 * change-password page is the only one (D52). A page with `permission` in its meta opens only for a
 * session that has it (D240). The customer site and the platform's pages are public and never read
 * the admin session (D93, D141).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const slug = splitTenantUrl(to.path)?.slug
  if (!slug || !isAdminPath(to.path)) return

  const { isLoggedIn, checked, mustChangePassword, fetchSession, can } = useAuth()

  if (!checked.value) await fetchSession()

  if (to.meta.public) {
    // Logged-in users have no business on the login page.
    if (to.path === loginPath(slug) && isLoggedIn.value) return navigateTo(adminHomePath(slug))
    return
  }

  if (!isLoggedIn.value) {
    return navigateTo({ path: loginPath(slug), query: { redirect: to.fullPath } })
  }

  if (mustChangePassword.value && to.path !== changePasswordPath(slug)) {
    return navigateTo({ path: changePasswordPath(slug), query: to.fullPath === adminHomePath(slug) ? {} : { redirect: to.fullPath } })
  }

  // A page the session's permissions don't include (a support visit on Platform support, D240): the
  // refusal page before anything loads, not the server's 403 on an empty page.
  if (to.meta.permission && !can(to.meta.permission)) {
    return abortNavigation(createError({ status: 403, statusText: 'No access to this page', data: { code: PAGE_FORBIDDEN }, fatal: true }))
  }
})
