import { apiError, notFound } from '#server/utils/errors'

/** Error codes of Telegram (step 8.1c, D112). */
export const NotificationErrorCodes = {
  /** A token is set but the bot's name or webhook secret is missing: a deployment mistake. */
  TELEGRAM_NOT_CONFIGURED: 'TELEGRAM_NOT_CONFIGURED',
  /** The link expired, was cancelled, or isn't waiting for this step. */
  TELEGRAM_LINK_UNUSABLE: 'TELEGRAM_LINK_UNUSABLE',
  /** The bot was removed from the group, or the person blocked it. */
  TELEGRAM_BLOCKED: 'TELEGRAM_BLOCKED',
  /** Telegram asked to wait (flood control). */
  TELEGRAM_RATE_LIMITED: 'TELEGRAM_RATE_LIMITED',
  /** Telegram refused or couldn't be reached. */
  TELEGRAM_UNAVAILABLE: 'TELEGRAM_UNAVAILABLE',
} as const

/** Without a bot token Telegram doesn't exist in this environment. */
export const telegramOff = () => notFound('This page')

export const telegramNotConfigured = (problem: string) =>
  apiError(500, NotificationErrorCodes.TELEGRAM_NOT_CONFIGURED, `Telegram's settings are incomplete: ${problem}`)

export const destinationNotFound = () => notFound('This Telegram chat')
export const linkNotFound = () => notFound('This link')

export const linkUnusable = () =>
  apiError(409, NotificationErrorCodes.TELEGRAM_LINK_UNUSABLE, 'This link doesn\'t work anymore. Start again with a new one.')

export const destinationBlocked = (title: string) =>
  apiError(409, NotificationErrorCodes.TELEGRAM_BLOCKED, `Telegram won't deliver to ${title}: the bot was removed or blocked there. Reconnect it on the Telegram page.`)

/**
 * Telegram's refusals are 4xx (D112): the request was fine, but the app shows only 4xx messages
 * (5xx is a crash, never shown), and these messages are ours and meant for the admin.
 */
export const telegramRateLimited = (seconds: number) =>
  apiError(429, NotificationErrorCodes.TELEGRAM_RATE_LIMITED, `Telegram asks to wait ${seconds} ${seconds === 1 ? 'second' : 'seconds'}. Try again then.`)

/** 424 Failed Dependency: Telegram, which the request depends on, refused or didn't answer. */
export const telegramUnavailable = () =>
  apiError(424, NotificationErrorCodes.TELEGRAM_UNAVAILABLE, 'Telegram didn\'t accept the message. Try again in a moment.')
