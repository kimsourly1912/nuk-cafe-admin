import { accountHome } from '../utils/account'

/**
 * Where "Back" goes on the account pages (D141): they're the platform's (no cafe in their address),
 * so it's the menu of the cafe of `?redirect=`, else the platform's page; never a guessed cafe (D220).
 */
export function useAccountHome() {
  const route = useRoute()
  return computed(() => accountHome(route.query.redirect))
}
