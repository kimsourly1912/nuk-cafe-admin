/**
 * The cafes the signed-in account works in, with the workspaces it may open in each
 * (`GET /api/me/cafes`, T2c, D144): Your cafes and the switcher. The session boundary clears it
 * with the identity.
 */
export function useAccountCafes() {
  return useApiQuery('cafe:mine', fetchAccountCafes)
}
