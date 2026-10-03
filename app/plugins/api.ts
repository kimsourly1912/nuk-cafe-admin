import { ofetch } from 'ofetch'
import { changePasswordPath, isAdminPath, loginPath, useAuth } from '~/features/auth'
import { counterChangePasswordPath, counterSignInPath, isCounterPath, useCounterSession } from '~/features/counter'
import { isPlatformPath, PLATFORM_CHANGE_PASSWORD, PLATFORM_SIGN_IN, usePlatformSession } from '~/features/platform'

/**
 * Configures `apiFetch` for our own API (`/api`, same origin: the session cookie goes along)
 * and sends the user to login when the session is lost mid-use.
 */
export default defineNuxtPlugin({
  name: 'api',
  setup(nuxtApp) {
    // Server rendering (the customer site) fetches per request instead (`apiFetch`, D95).
    if (import.meta.server) return
    const router = useRouter()
    const auth = useAuth()
    // The counter workspace keeps its own session (D102); a lost session ends both.
    const counter = useCounterSession()
    // So does the platform console (D142).
    const platform = usePlatformSession()
    // The cafe whose API this app calls (D140, D141): the one in the page's address. Read from the
    // browser's address, not the router's: a route middleware calls the API before the router has
    // moved (its first page included). Moving to another cafe is a full page load (D141). The
    // platform's pages (no cafe) use NUK Cafe's until a cafe can be chosen (T2).
    const defaultTenant = useRuntimeConfig().public.defaultTenant
    const tenant = () => splitTenantUrl(window.location.pathname)?.slug ?? defaultTenant

    configureApi(createApiFetch({
      // Same engine as Nuxt's $fetch; created from ofetch directly for its types.
      // Fails as ApiError kind 'timeout' instead of hanging forever.
      // `/api`: the standard's routes (`/admin/me`, `/admin/menu/…`).
      baseFetch: ofetch.create({ baseURL: '/api', timeout: 30_000 }),
      onSessionLost: () => {
        auth.clearSession()
        counter.clearSession()
        platform.clearSession()
      },
      onPasswordChangeRequired: () => {
        auth.requirePasswordChange()
        counter.requirePasswordChange()
        platform.requirePasswordChange()
      },
      // Any workspace's identity changing discards responses to older requests.
      sessionGeneration: () => auth.generation.value + counter.generation.value + platform.generation.value,
    }), tenant)

    // The cafe of the page on screen, for the redirects below (D141).
    const slugOf = (path: string) => splitTenantUrl(path)?.slug ?? defaultTenant

    // A temporary password (at login, or reported by a route): only the change-password page. The
    // customer site (outside the admin) never reads the admin session, so it's left alone (D93).
    watch(auth.mustChangePassword, (must) => {
      const path = router.currentRoute.value.path
      const target = changePasswordPath(slugOf(path))
      if (must && isAdminPath(path) && path !== target) nuxtApp.runWithContext(() => navigateTo(target))
    })

    // Session lost mid-use (expired, signed out elsewhere, admin access removed): back to login.
    watch(auth.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && isAdminPath(route.path) && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: loginPath(slugOf(route.path)), query: { redirect: route.fullPath } }))
      }
    })

    // The same for the counter workspace: a temporary password, or a session lost mid-use.
    watch(counter.mustChangePassword, (must) => {
      const path = router.currentRoute.value.path
      const target = counterChangePasswordPath(slugOf(path))
      if (must && isCounterPath(path) && path !== target) nuxtApp.runWithContext(() => navigateTo(target))
    })
    watch(counter.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && isCounterPath(route.path) && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: counterSignInPath(slugOf(route.path)), query: { redirect: route.fullPath } }))
      }
    })

    // And for the platform console (D142).
    watch(platform.mustChangePassword, (must) => {
      const path = router.currentRoute.value.path
      if (must && isPlatformPath(path) && path !== PLATFORM_CHANGE_PASSWORD) nuxtApp.runWithContext(() => navigateTo(PLATFORM_CHANGE_PASSWORD))
    })
    watch(platform.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && isPlatformPath(route.path) && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: PLATFORM_SIGN_IN, query: { redirect: route.fullPath } }))
      }
    })
  },
})
