import type { TelegramOverview } from '#shared/contracts/notifications'
import type { AdminSetupStep } from '~/types/admin-setup'

/** The home page's setup step (D155): new orders on Telegram. Not offered where the bot isn't set up. */
export const telegramSetup: AdminSetupStep = {
  id: 'telegram',
  label: 'Get new orders on Telegram',
  description: 'An alert in your chat for every order and payment.',
  page: '/admin/telegram',
  optional: true,
  async check() {
    const overview = await apiFetch<TelegramOverview>('/admin/telegram')
    if (!overview.enabled) return null
    return overview.destinations.some(destination => destination.status === 'connected')
  },
}
