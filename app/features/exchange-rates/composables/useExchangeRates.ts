import type { ExchangeRates, SetExchangeRateInput } from '#shared/contracts/orders'

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
