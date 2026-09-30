import type { H3Event } from 'h3'
import { Api } from 'grammy'
import { telegramOff, telegramSettingsFrom } from '../features/notifications'
import type { TelegramSettings } from '../features/notifications'

/**
 * Route glue for Telegram (step 8.1c, D112). `useTelegram` is the settings, or `null` when this
 * environment has no bot token; `requireTelegram` answers 404 then, and gives the bot's `Api`
 * (grammY) with a 20-second timeout: a request never waits on Telegram longer than that.
 */
export function useTelegram(event?: H3Event): TelegramSettings | null {
  return telegramSettingsFrom(useRuntimeConfig(event).telegram)
}

export function telegramApi(settings: TelegramSettings): Api {
  return new Api(settings.botToken, { timeoutSeconds: 20 })
}

export function requireTelegram(event: H3Event): { settings: TelegramSettings, api: Api } {
  const settings = useTelegram(event)
  if (!settings) throw telegramOff()
  return { settings, api: telegramApi(settings) }
}
