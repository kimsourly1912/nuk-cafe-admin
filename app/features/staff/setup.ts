import type { Page } from '#shared/contracts/common'
import type { StaffMember } from '#shared/contracts/staff'
import type { AdminSetupStep } from '~/types/admin-setup'

/** The home page's setup step (D155): someone besides the owner, for the counter. */
export const staffSetup: AdminSetupStep = {
  id: 'staff',
  label: 'Add your staff',
  description: 'Cashiers sign in to the counter with their own account.',
  page: '/admin/staff',
  optional: true,
  async check() {
    const page = await apiFetch<Page<StaffMember>>('/admin/staff', { query: { pageSize: 1 } })
    return page.total > 1
  },
}
