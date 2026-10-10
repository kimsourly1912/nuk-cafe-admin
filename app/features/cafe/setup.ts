import type { CafeSettings } from '#shared/contracts/cafe'
import type { AdminSetupStep } from '~/types/admin-setup'

/** The home page's setup step (D155): the cafe's logo, on its menu and receipts. */
export const cafeSetup: AdminSetupStep = {
  id: 'cafe-logo',
  label: 'Add your logo',
  description: 'It shows on your menu, the counter and printed reports.',
  page: '/admin/cafe',
  optional: true,
  async check() {
    const cafe = await apiFetch<CafeSettings>('/admin/cafe')
    return cafe.logoUrl !== null
  },
}
