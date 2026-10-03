import { accountHome } from '../utils/account'

/**
 * The menu "Back to the menu" means on the account pages (D141): they're the platform's (no cafe
 * in their address), so it's the cafe of `?redirect=`, else the default cafe's.
 */
export function useAccountHome() {
  const route = useRoute()
  const fallback = useRuntimeConfig().public.defaultTenant
  return computed(() => accountHome(route.query.redirect, fallback))
}
