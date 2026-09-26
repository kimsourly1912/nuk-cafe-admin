import { ofetch } from 'ofetch'
import { useAuth } from '~/features/auth'
import { client } from '~/generated/api/client.gen'

/**
 * Configures the generated SDK (app/generated/api) to call the backend through
 * `createApiFetch`, which adds cookie credentials, error normalization and token refresh.
 */
export default defineNuxtPlugin({
  name: 'api',
  setup(nuxtApp) {
    const config = useRuntimeConfig()
    const router = useRouter()
    const auth = useAuth()

    // Same engine as Nuxt's $fetch; created from ofetch directly for its types.
    const baseFetch = ofetch.create({
      baseURL: config.public.apiBase,
      credentials: 'include',
    })

    client.setConfig({
      baseUrl: config.public.apiBase,
      credentials: 'include',
      ofetch: createApiFetch({
        baseFetch,
        onSessionExpired: () => auth.clearSession(),
      }),
    })

    // Session lost mid-use (refresh failed): send the user back to login.
    watch(auth.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: '/login', query: { redirect: route.fullPath } }))
      }
    })
  },
})
