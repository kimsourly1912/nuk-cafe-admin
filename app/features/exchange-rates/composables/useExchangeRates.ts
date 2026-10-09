import type { BakongConnectionTest, BakongTokenInput, ExchangeRates, KhqrSettings, KhqrSettingsInput, RemoveBakongTokenInput, SetExchangeRateInput } from '#shared/contracts/orders'

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
  // The cafe's Bakong token (T2d, D148): sent once, never answered back.
  const saveToken = useMutation(
    (input: BakongTokenInput) => apiFetch<KhqrSettings>('/admin/khqr/token', { method: 'PUT', body: input }),
    {
      id: 'exchange-rates:bakong-token',
      lock: () => 'bakong-token',
      successMessage: (_, input) => (input.version ? 'Bakong token replaced' : 'Bakong token saved: the counter checks KHQR payments with Bakong'),
      errorMessage: 'Could not save the Bakong token',
      // The counter's queue says whether its check is on.
      invalidate: ['exchange-rates', 'counter'],
    },
  )
  const removeToken = useMutation(
    (input: RemoveBakongTokenInput) => apiFetch<KhqrSettings>('/admin/khqr/token', { method: 'DELETE', body: input }),
    {
      id: 'exchange-rates:bakong-token-remove',
      lock: () => 'bakong-token',
      confirm: () => ({
        title: 'Remove the Bakong token?',
        description: 'The counter stops checking KHQR payments with Bakong: cashiers confirm each one by hand until a token is saved again.',
        confirmLabel: 'Remove token',
        danger: true,
      }),
      successMessage: 'Bakong token removed: cashiers confirm KHQR payments by hand',
      errorMessage: 'Could not remove the Bakong token',
      invalidate: ['exchange-rates', 'counter'],
    },
  )
  return { save, saveToken, removeToken }
}

/** Whether this cafe's token gets an answer from Bakong (10.15b D131, D148). Changes nothing. */
export function testBakongConnection() {
  return apiFetch<BakongConnectionTest>('/admin/khqr/test', { method: 'POST' })
}
