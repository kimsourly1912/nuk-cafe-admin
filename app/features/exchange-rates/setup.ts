import type { ExchangeRates, KhqrSettings } from '#shared/contracts/orders'
import type { AdminSetupStep } from '~/types/admin-setup'

/** The home page's setup steps (D155): the riel rate for cash in riel, and KHQR at the counter. */
export const rielRateSetup: AdminSetupStep = {
  id: 'riel-rate',
  label: 'Set the riel rate',
  description: 'The counter needs it to take cash in riel.',
  page: '/admin/payments',
  async check() {
    const rates = await apiFetch<ExchangeRates>('/admin/exchange-rates')
    return rates.current !== null
  },
}

export const khqrSetup: AdminSetupStep = {
  id: 'khqr',
  label: 'Take KHQR payments',
  description: 'Customers pay at the counter with any Cambodian banking app.',
  page: '/admin/payments',
  optional: true,
  async check() {
    const settings = await apiFetch<KhqrSettings>('/admin/khqr')
    return settings.enabled
  },
}
