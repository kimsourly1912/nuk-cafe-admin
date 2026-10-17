import type { BranchOption } from '#shared/contracts/staff'

/**
 * PUBLIC. The cafe's active branches. The one query for `/admin/branches/options`: the Branch page,
 * staff memberships and promotions share it, so a branch change refreshes all of them.
 */
export function useBranchOptions() {
  return useApiQuery('branches:options', () => apiFetch<BranchOption[]>('/admin/branches/options'))
}
