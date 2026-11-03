import { useBroadcastChannel } from '@vueuse/core'
import { adminHomePath, changePasswordPath, isAdminPath, loginPath, loginRedirectTarget, useAuth } from '~/features/auth'
import { counterChangePasswordPath, counterHomePath, counterRedirectTarget, counterSignInPath, isCounterPath, useCounterSession } from '~/features/counter'
import { isPlatformPath, PLATFORM_CHANGE_PASSWORD, PLATFORM_HOME, PLATFORM_SIGN_IN, PLATFORM_TWO_FACTOR, platformRedirectTarget, usePlatformSession } from '~/features/platform'
import type { AuthEvent } from '~/composables/useSessionIdentity'

/** Only event metadata crosses tabs; each active surface rechecks its own authorization. */
export default defineNuxtPlugin((nuxtApp) => {
  const identity = useSessionIdentity()
  const router = useRouter()
  const auth = useAuth()
  const counter = useCounterSession()
  const platform = usePlatformSession()
  const rechecking = useState('session-identity:rechecking', () => false)
  const { isSupported, data: message, post } = useBroadcastChannel<{ event: AuthEvent }, { event: AuthEvent }>({ name: 'nuk-cafe-admin:auth' })
  if (!isSupported.value) return

  nuxtApp.hook('app:auth-changed', event => post({ event }))
  let revision = 0
  watch(message, async (received) => {
    if (received?.event !== 'login' && received?.event !== 'logout' && received?.event !== 'refresh') return
    const route = router.currentRoute.value
    const slug = splitTenantUrl(route.path)?.slug
    const surface = isAdminPath(route.path) ? 'admin' : isCounterPath(route.path) ? 'counter' : isPlatformPath(route.path) ? 'platform' : 'account'
    if (received.event === 'refresh') {
      if (rechecking.value) return // Its in-progress identity check already reads the newest flags.
      const startedIn = identity.generation.value
      await nuxtApp.runWithContext(() => invalidateInThisTab(['account', 'account-sessions']))
      if (rechecking.value || startedIn !== identity.generation.value) return
      if (surface === 'account') return
      const session = surface === 'admin' ? auth : surface === 'counter' ? counter : platform
      const forced = session.mustChangePassword.value
      const neededSetup = surface === 'platform' && !platform.twoFactorEnabled.value
      await session.fetchSession()
      if (rechecking.value || startedIn !== identity.generation.value) return
      if (router.currentRoute.value.fullPath !== route.fullPath || !session.user.value) return
      const passwordPath = surface === 'admin' ? changePasswordPath(slug!) : surface === 'counter' ? counterChangePasswordPath(slug!) : PLATFORM_CHANGE_PASSWORD
      if ((forced && !session.mustChangePassword.value && route.path === passwordPath)
        || (neededSetup && platform.twoFactorEnabled.value && route.path === PLATFORM_TWO_FACTOR)) {
        const target = surface === 'admin' ? loginRedirectTarget(route.query.redirect, slug!) : surface === 'counter' ? counterRedirectTarget(route.query.redirect, slug!) : platformRedirectTarget(route.query.redirect)
        const home = surface === 'admin' ? adminHomePath(slug!) : surface === 'counter' ? counterHomePath(slug!) : PLATFORM_HOME
        await nuxtApp.runWithContext(() => navigateTo(target.split(/[?#]/)[0] === route.path ? home : target, { replace: true }))
      }
      return
    }
    const currentRead = ++revision
    if (received.event === 'logout') {
      await identity.change('logout', undefined, false)
      rechecking.value = false
      return
    }
    rechecking.value = surface !== 'account'
    await identity.change('login', surface, false)
    if (surface === 'account') return
    if (currentRead !== revision) return
    const session = surface === 'admin' ? auth : surface === 'counter' ? counter : platform
    session.resetSession()
    try {
      await session.fetchSession()
      if (currentRead !== revision) return
      const current = router.currentRoute.value
      if (current.fullPath !== route.fullPath) return
      const signIn = surface === 'admin' ? loginPath(slug!) : surface === 'counter' ? counterSignInPath(slug!) : PLATFORM_SIGN_IN
      if (!session.user.value) {
        if (current.path !== signIn) await nuxtApp.runWithContext(() => navigateTo({ path: signIn, query: { redirect: route.fullPath } }))
      }
      else if (current.path === signIn) {
        const target = surface === 'admin' ? loginRedirectTarget(route.query.redirect, slug!) : surface === 'counter' ? counterRedirectTarget(route.query.redirect, slug!) : platformRedirectTarget(route.query.redirect)
        await nuxtApp.runWithContext(() => navigateTo(target, { replace: true }))
      }
    }
    finally {
      if (currentRead === revision) rechecking.value = false
    }
  })
})
