/**
 * Route changes and overlay entries (D201, `app/utils/overlay-history.ts`): our entries are stepped
 * back over before the router writes its own, after the other guards (the unsaved-changes question)
 * let the change go ahead.
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  const history = overlayHistory()
  router.beforeEach(() => history.beforeNavigate())
  router.afterEach(() => history.afterNavigate())
  router.onError(() => history.afterNavigate())
  history.leaveStaleEntry()
})
