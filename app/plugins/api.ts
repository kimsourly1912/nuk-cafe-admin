import { ofetch } from 'ofetch'
import { useAuth } from '~/features/auth'

/**
 * Configures `apiFetch` for our own API (`/api/v1`, same origin: the session cookie goes along)
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
      baseFetch: ofetch.create({ baseURL: '/api/v1', timeout: 30_000 }),
      onSessionLost: () => auth.clearSession(),
      sessionGeneration: () => auth.generation.value,
    }))

    // Session lost mid-use (expired, signed out elsewhere, staff access removed): back to login.
    watch(auth.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: '/login', query: { redirect: route.fullPath } }))
      }
    })
  },
})
