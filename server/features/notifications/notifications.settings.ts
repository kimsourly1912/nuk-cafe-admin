import { telegramNotConfigured } from './notifications.errors'

/**
 * The bot's settings (step 8.1c, D112), from runtime config (`NUXT_TELEGRAM_*`, secrets on the
 * Worker, never in the repository or the app).
 */
export interface TelegramSettings {
  botToken: string
  /** Without `@`, e.g. `NukCafeBot`: the connect links are `t.me/<name>`. */
  botUsername: string
  /** Telegram sends it in `X-Telegram-Bot-Api-Secret-Token` on every webhook call. */
  webhookSecret: string
}

export interface RawTelegramSettings {
  botToken?: string
  botUsername?: string
  webhookSecret?: string
}

/**
 * `null` (Telegram is off) without a token. With a token, the rest must be complete: a missing
 * name or secret is a deployment mistake, refused with 500 rather than silently switched off.
 */
export function telegramSettingsFrom(raw: RawTelegramSettings): TelegramSettings | null {
  const botToken = raw.botToken?.trim()
  if (!botToken) return null
  const botUsername = raw.botUsername?.trim().replace(/^@/, '')
  if (!botUsername || !/^\w{5,32}$/.test(botUsername)) throw telegramNotConfigured('NUXT_TELEGRAM_BOT_USERNAME is missing or not a bot name.')
  const webhookSecret = raw.webhookSecret?.trim()
  // Telegram allows 1–256 characters of A–Z, a–z, 0–9, _ and -; ask for a real secret's length.
  if (!webhookSecret || !/^[\w-]{32,256}$/.test(webhookSecret)) throw telegramNotConfigured('NUXT_TELEGRAM_WEBHOOK_SECRET must be 32–256 letters, digits, _ or -.')
  return { botToken, botUsername, webhookSecret }
}
