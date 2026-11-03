/** A route through an account page must not carry another cafe's cached sessions/data (D141). */
export default defineNuxtRouteMiddleware(async (to) => {
  if (useError().value && (import.meta.server || useNuxtApp().isHydrating)) return
  const bound = useState<string | null>('tenant:app', () => null)
  const next = tenantNavigation(bound.value, to.path)
  if (next.reload) {
    if (!await useLeaveGuard().confirmLeave()) return abortNavigation()
    return navigateTo(to.fullPath, { external: true, replace: true })
  }
  bound.value = next.tenant
})
