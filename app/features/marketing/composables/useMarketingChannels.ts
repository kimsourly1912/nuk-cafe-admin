import type { MarketingChannels } from '#shared/contracts/marketing'

/**
 * The cafe's channels and whether this server has a Telegram bot (`/api/admin/marketing/channels`,
 * M2a, D164). Public: the promotion page's Post to channels dialog lists them too.
 */
export function useMarketingChannels() {
  return useApiQuery('marketing:channels', () => apiFetch<MarketingChannels>('/admin/marketing/channels'))
}
