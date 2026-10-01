import * as v from 'valibot'

/**
 * Telegram (step 8.1c, docs/plans/reports.md, D112): the chats the cafe's messages go to, how an
 * admin connects one, and sending a report there. The bot's token and secrets never leave the
 * server; the app sees a destination's name and state only.
 */

export const DESTINATION_KINDS = ['private', 'group'] as const
export type DestinationKind = typeof DESTINATION_KINDS[number]

/**
 * - `connected`: messages can go there;
 * - `blocked`: the bot was removed from the group, or the person blocked it (Reconnect);
 * - `disconnected`: an admin disconnected it (kept for the history of what was sent).
 */
export const DESTINATION_STATUSES = ['connected', 'blocked', 'disconnected'] as const
export type DestinationStatus = typeof DESTINATION_STATUSES[number]

export interface TelegramDestination {
  id: string
  kind: DestinationKind
  /** The group's title, or the person's name in Telegram. */
  title: string
  status: Exclude<DestinationStatus, 'disconnected'>
  connectedBy: string | null
  connectedAt: string
  lastSentAt: string | null
  /** When it became blocked. */
  blockedAt: string | null
  version: number
}

/** `GET /api/admin/telegram`. */
export interface TelegramOverview {
  /** Off until the bot's token, name and webhook secret are set in this environment. */
  enabled: boolean
  botUsername: string | null
  /** Connected and blocked ones; disconnected ones aren't listed. */
  destinations: TelegramDestination[]
  /** Which chat gets which notification (8.1d, D113). */
  rules: NotificationRule[]
}

/** How long a connect link works (and a group waits for its confirmation). */
export const TELEGRAM_LINK_MINUTES = 10

export const createTelegramLinkSchema = v.object({ kind: v.picklist(DESTINATION_KINDS) })
export type CreateTelegramLinkInput = v.InferOutput<typeof createTelegramLinkSchema>

/**
 * - `waiting`: the admin hasn't opened it in Telegram yet;
 * - `confirm`: a group admin added the bot to a group; the portal asks before connecting it;
 * - `connected`: done (`destinationId`);
 * - `cancelled`, `expired`: can't be used any more.
 */
export const TELEGRAM_LINK_STATUSES = ['waiting', 'confirm', 'connected', 'cancelled', 'expired'] as const
export type TelegramLinkStatus = typeof TELEGRAM_LINK_STATUSES[number]

export interface TelegramLink {
  id: string
  kind: DestinationKind
  status: TelegramLinkStatus
  expiresAt: string
  /** The group waiting for confirmation (`confirm`), or the chat connected. */
  chat: { title: string, memberCount: number | null } | null
  destinationId: string | null
}

/** `POST /api/admin/telegram/links`: the link to open in Telegram, only in this answer. */
export interface NewTelegramLink extends TelegramLink {
  url: string
}

export const destinationVersionSchema = v.object({ version: v.pipe(v.number(), v.integer(), v.minValue(1)) })

// --- Sending a report (report: ['export']) ---

export const SENDABLE_REPORTS = ['summary', 'items'] as const
export type SendableReport = typeof SENDABLE_REPORTS[number]

/**
 * A report to send, as the page shows it (`POST /api/admin/reports/telegram-preview` and `…/send`):
 * its kind and the page's query as the URL has it (text values), checked by the report's own query
 * schema on the server.
 */
export const reportMessageSchema = v.object({
  kind: v.picklist(SENDABLE_REPORTS),
  query: v.record(v.string(), v.pipe(v.string(), v.maxLength(200))),
})
export type ReportMessageInput = v.InferOutput<typeof reportMessageSchema>

export const sendReportSchema = v.object({
  report: reportMessageSchema,
  destinationId: v.pipe(v.string(), v.minLength(1)),
  /** Also send the report's CSV as a file. */
  attachCsv: v.optional(v.boolean(), false),
})
export type SendReportInput = v.InferOutput<typeof sendReportSchema>

/** The message as Telegram shows it, as plain text for the preview (the server sends it formatted). */
export interface ReportMessagePreview {
  text: string
}

export interface ReportSent {
  destination: { id: string, title: string }
  sentAt: string
}

// --- Notifications and their delivery (step 8.1d, D113) ---

/**
 * - `new_order`: an order placed (for the staff group);
 * - `payment`: its payment taken;
 * - `closing_summary`: the day's Summary, 30 minutes after the last opening window ends.
 */
export const NOTIFICATION_KINDS = ['new_order', 'payment', 'closing_summary', 'server_error'] as const
export type NotificationKind = typeof NOTIFICATION_KINDS[number]

/**
 * Server errors (step 10.4, D119): at most one alert per route in this many minutes, per chat, so a
 * failing page during a rush doesn't flood the chat.
 */
export const SERVER_ERROR_ALERT_WINDOW_MINUTES = 15

/** One chat receiving one kind of notification. */
export interface NotificationRule {
  kind: NotificationKind
  destinationId: string
  /** Closing summary only: the day's CSV as a second message. */
  attachCsv: boolean
}

export const setNotificationRuleSchema = v.object({
  kind: v.picklist(NOTIFICATION_KINDS),
  destinationId: v.pipe(v.string(), v.minLength(1)),
  enabled: v.boolean(),
  attachCsv: v.optional(v.boolean(), false),
})
export type SetNotificationRuleInput = v.InferOutput<typeof setNotificationRuleSchema>

/**
 * - `pending`: waiting to be sent, or to be tried again (`nextAttemptAt`, after Telegram asked to
 *   wait or didn't answer);
 * - `sent`;
 * - `failed`: it stopped trying (the chat is blocked, or 8 tries failed); Retry sends it again.
 */
export const DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const
export type DeliveryStatus = typeof DELIVERY_STATUSES[number]

/** The most tries before a delivery is `failed` (1, 2, 4 … minutes apart, at most 6 h). */
export const DELIVERY_MAX_ATTEMPTS = 8

export interface NotificationDelivery {
  id: string
  kind: NotificationKind | 'report'
  /** "New order #042", "Closing summary · Tue 30 Sep 2026". */
  subject: string
  destination: { id: string, title: string }
  status: DeliveryStatus
  attempts: number
  /** When the next try is due (`pending` after a failed try). */
  nextAttemptAt: string | null
  /** Why the last try failed, in the admin's words. */
  lastError: string | null
  createdAt: string
  sentAt: string | null
}

export interface NotificationDeliveries {
  deliveries: NotificationDelivery[]
}

/** A delivery's message as it was saved (the closing summary's snapshot), as plain text. */
export interface DeliverySnapshot {
  id: string
  subject: string
  text: string
  attachment: string | null
}
