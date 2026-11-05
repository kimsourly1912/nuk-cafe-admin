/** COOP belongs to the loaded document; SPA entry cannot install auth's popup headers (D261). */
const isGoogleEntry = (path: string) => /^\/(?:sign-in|sign-up|platform\/sign-in|c\/[^/]+\/(?:admin\/login|counter\/sign-in))$/.test(path)

export default defineNuxtRouteMiddleware(async (to, from) => {
  if (import.meta.server || !isGoogleEntry(to.path)) return
  // An auth redirect during hydration still needs a new document; only direct entry may skip it.
  if (useNuxtApp().isHydrating && to.path === window.location.pathname) return
  if (isGoogleEntry(from.path)) return
  if (!await useLeaveGuard().confirmLeave()) return abortNavigation()
  return navigateTo(to.fullPath, { external: true, replace: Boolean(to.redirectedFrom) })
})
