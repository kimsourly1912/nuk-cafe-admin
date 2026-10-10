import type { BranchSettings } from '#shared/contracts/branches'
import type { BranchOption } from '#shared/contracts/staff'
import type { AdminSetupStep } from '~/types/admin-setup'

/** The home page's setup step (D155): a branch with opening hours, so the menu can take orders. */
export const branchesSetup: AdminSetupStep = {
  id: 'branch-hours',
  label: 'Set your opening hours',
  description: 'Customers can order only while a branch is open.',
  page: '/admin/branches',
  async check() {
    const branches = await apiFetch<BranchOption[]>('/admin/branches/options')
    const settings = await Promise.all(branches.map(branch => apiFetch<BranchSettings>(`/admin/branches/${branch.id}`)))
    return settings.some(branch => branch.status === 'active' && branch.hours.length > 0)
  },
}
