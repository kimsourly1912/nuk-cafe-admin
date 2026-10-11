import type { MarketingChannels } from '#shared/contracts/marketing'
import { listChannels } from '#server/features/marketing'

/** The cafe's channels (connected, or with the bot removed), and whether this server has a bot. */
export default defineEventHandler(async (event): Promise<MarketingChannels> => {
  const actor = await requirePermission(event, { menu: ['read'] })
  const settings = useTelegram(event)
  return {
    telegram: { enabled: !!settings, botUsername: settings?.botUsername ?? null },
    channels: settings ? await listChannels(useDb(), actor.tenantId) : [],
  }
})
