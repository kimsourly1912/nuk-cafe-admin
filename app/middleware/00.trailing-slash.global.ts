import { withoutTrailingSlash } from '#shared/utils/address'

/**
 * A link inside the app to a slashed address (`/c/nuk/`) goes to the one without (D208), as the
 * server redirects a typed or pasted one. First of the global middleware (file name order), so the
 * sign-in checks see one form only.
 */
export default defineNuxtRouteMiddleware((to) => {
  const target = withoutTrailingSlash(to.fullPath)
  if (target) return navigateTo(target, { replace: true, redirectCode: 301 })
})
