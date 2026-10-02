import type { ExchangeRates, KhqrSettings, KhqrSettingsInput, SetExchangeRateInput } from '#shared/contracts/orders'

/** The riel rate in force and its history (`/api/admin/exchange-rates`, D101). */
export function useExchangeRates() {
  return useApiQuery('exchange-rates:all', () => apiFetch<ExchangeRates>('/admin/exchange-rates'))
}

export function useExchangeRateMutations() {
  const set = useMutation(
    (input: SetExchangeRateInput) => apiFetch<ExchangeRates>('/admin/exchange-rates', { method: 'POST', body: input }),
    {
      id: 'exchange-rates:set',
      lock: () => 'exchange-rate',
      successMessage: (_, input) => `Riel rate set to ៛${input.khrPerUsd.toLocaleString('en-US')} per $1`,
      errorMessage: 'Could not save the riel rate',
      // The counter's queue carries the rate.
      invalidate: ['exchange-rates', 'counter'],
    },
  )
  return { set }
}

/** KHQR at the counter (`/api/admin/khqr`, step 10.15, D130): the receiving Bakong account. */
export function useKhqrSettings() {
  return useApiQuery('exchange-rates:khqr', () => apiFetch<KhqrSettings>('/admin/khqr'))
}

export function useKhqrSettingsMutations() {
  const save = useMutation(
    (input: KhqrSettingsInput) => apiFetch<KhqrSettings>('/admin/khqr', { method: 'PUT', body: input }),
    {
      id: 'exchange-rates:khqr',
      lock: () => 'khqr-settings',
      successMessage: (settings: KhqrSettings) => (settings.enabled ? 'KHQR settings saved: the counter shows a QR for each order' : 'KHQR settings saved: KHQR at the counter is off'),
      errorMessage: 'Could not save the KHQR settings',
      // The counter's queue says whether KHQR is on.
      invalidate: ['exchange-rates', 'counter'],
    },
  )
  return { save }
}
