import { ofetch } from 'ofetch'
import { ConfirmIdentityModal } from '#components'
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
    const identity = useSessionIdentity()
    const rechecking = useState('session-identity:rechecking', () => false)
    // The cafe whose API this app calls (D140, D141): the one in the page's address. Read from the
    // browser's address, not the router's: a route middleware calls the API before the router has
    // moved (its first page included). Moving to another cafe is a full page load (D141). The
    // platform's pages have none: a cafe's API called there throws (`apiPath`, D221).
    const tenant = () => splitTenantUrl(window.location.pathname)?.slug ?? null

    // "Confirm it's you" before a dangerous change (D246). One dialog at a time: two requests asking
    // together share it. A session change closes it (session-boundary), which counts as cancelled.
    const overlay = useOverlay()
    let asking: Promise<boolean> | undefined
    const confirmIdentity = () => {
      asking ??= overlay.create(ConfirmIdentityModal, { destroyOnClose: true }).open().result
        .then(confirmed => confirmed === true)
        .finally(() => {
          asking = undefined
        })
      return asking
    }

    configureApi(createApiFetch({
      // Same engine as Nuxt's $fetch; created from ofetch directly for its types.
      // Fails as ApiError kind 'timeout' instead of hanging forever.
      // `/api`: the standard's routes (`/admin/me`, `/admin/menu/…`).
      baseFetch: ofetch.create({ baseURL: '/api', timeout: 30_000 }),
      onSessionLost: () => {
        if (identity.isSignedIn.value || auth.user.value || counter.user.value || platform.user.value) identity.change('logout', undefined, false)
      },
      onPasswordChangeRequired: () => {
        auth.requirePasswordChange()
        counter.requirePasswordChange()
        platform.requirePasswordChange()
      },
      // Any workspace's identity changing discards responses to older requests.
      sessionGeneration: () => identity.generation.value,
      onConfirmationRequired: confirmIdentity,
    }), tenant)

    // The cafe of the page on screen, for the redirects below (D141). They act only on a cafe's
    // admin or counter pages, whose address always names one.
    const slugOf = (path: string) => splitTenantUrl(path)!.slug

    // A temporary password (at login, or reported by a route): only the change-password page. The
    // customer site (outside the admin) never reads the admin session, so it's left alone (D93).
    watch(auth.mustChangePassword, (must) => {
      const path = router.currentRoute.value.path
      if (!must || !isAdminPath(path) || router.currentRoute.value.meta.public || rechecking.value) return
      const target = changePasswordPath(slugOf(path))
      if (path !== target) nuxtApp.runWithContext(() => navigateTo({ path: target, query: { redirect: router.currentRoute.value.fullPath } }))
    })

    // Session lost mid-use (expired, signed out elsewhere, admin access removed): back to login.
    watch(auth.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && !auth.signingOut.value && !rechecking.value && isAdminPath(route.path) && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: loginPath(slugOf(route.path)), query: { redirect: route.fullPath } }))
      }
    })

    // The same for the counter workspace: a temporary password, or a session lost mid-use.
    watch(counter.mustChangePassword, (must) => {
      const path = router.currentRoute.value.path
      if (!must || !isCounterPath(path) || router.currentRoute.value.meta.public || rechecking.value) return
      const target = counterChangePasswordPath(slugOf(path))
      if (path !== target) nuxtApp.runWithContext(() => navigateTo({ path: target, query: { redirect: router.currentRoute.value.fullPath } }))
    })
    watch(counter.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && !counter.signingOut.value && !rechecking.value && isCounterPath(route.path) && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: counterSignInPath(slugOf(route.path)), query: { redirect: route.fullPath } }))
      }
    })

    // And for the platform console (D142).
    watch(platform.mustChangePassword, (must) => {
      const path = router.currentRoute.value.path
      if (must && isPlatformPath(path) && path !== PLATFORM_CHANGE_PASSWORD && !router.currentRoute.value.meta.public && !rechecking.value) nuxtApp.runWithContext(() => navigateTo({ path: PLATFORM_CHANGE_PASSWORD, query: { redirect: router.currentRoute.value.fullPath } }))
    })
    watch(platform.user, (user, previous) => {
      const route = router.currentRoute.value
      if (!user && previous && !platform.signingOut.value && !rechecking.value && isPlatformPath(route.path) && !route.meta.public) {
        nuxtApp.runWithContext(() => navigateTo({ path: PLATFORM_SIGN_IN, query: { redirect: route.fullPath } }))
      }
    })
  },
})
