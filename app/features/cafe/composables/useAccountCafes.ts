/**
 * The cafes the signed-in account works in, with the workspaces it may open in each
 * (`GET /api/me/cafes`, T2c, D144): Your cafes and the switcher. The session boundary clears it
 * with the identity.
 */
export function useAccountCafes() {
  return useApiQuery('cafe:mine', fetchAccountCafes)
}

/**
 * Whether the signed-in account is on the platform team (Better Auth's session role), for Your
 * cafes' link to the console (Q5, D241). Only what to show: the console checks the role itself.
 */
export function usePlatformTeam() {
  return useApiQuery('cafe:platform-team', isPlatformTeamSession, { server: false, default: () => false })
}
