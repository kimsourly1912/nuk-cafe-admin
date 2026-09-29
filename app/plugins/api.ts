import { ofetch } from 'ofetch'
import { CHANGE_PASSWORD_PATH, isAdminPath, LOGIN_PATH, useAuth } from '~/features/auth'

/**
 * Configures `apiFetch` for our own API (`/api`, same origin: the session cookie goes along)
 * and sends the user to login when the session is lost mid-use.
 */
export default defineNuxtPlugin({
  name: 'api',
  setup(nuxtApp) {
    const router = useRouter()
    const auth = useAuth()

    configureApi(createApiFetch({
      // Same engine as Nuxt's $fetch; created from ofetch directly for its types.
      // Fails as ApiError kind 'timeout' instead of hanging forever.
      // `/api`: the standard's routes (`/admin/me`, `/admin/menu/…`).
      baseFetch: ofetch.create({ baseURL: '/api', timeout: 30_000 }),
      onSessionLost: () => auth.clearSession(),
      onPasswordChangeRequired: () => auth.requirePasswordChange(),
      sessionGeneration: () => auth.generation.value,
    }))

    // A temporary password (at login, or reported by a route): only the change-password page. The
    // customer site (outside /admin) never reads the admin session, so it's left alone (D93).
    watch(auth.mustChangePassword, (must) => {
      const path = router.currentRoute.value.path
      if (must && isAdminPath(path) && path !== CHANGE_PASSWORD_PATH) nuxtApp.runWithContext(() => navigateTo(CHANGE_PASSWORD_PATH))
    })

    // Session lost mid-use (expired, signed out elsewhere, admin access removed): back to login.
    watch(auth.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && isAdminPath(route.path) && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: LOGIN_PATH, query: { redirect: route.fullPath } }))
      }
    })
  },
})
