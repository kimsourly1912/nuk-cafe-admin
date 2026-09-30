import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { DELIVERY_STATUSES, DESTINATION_KINDS, DESTINATION_STATUSES, NOTIFICATION_KINDS, TELEGRAM_LINK_STATUSES } from '#shared/contracts/notifications'
import { newId } from '#server/utils/ids'

/**
 * Telegram (step 8.1c, D112): the chats the cafe's messages go to, and the one-time links that
 * connect them. Registered with NuxtHub through the `hub:db:schema:extend` hook.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })

/**
 * A Telegram chat messages can go to: an admin's private chat or a group. One row per chat
 * (`chat_id` unique): reconnecting a chat brings its row back. Disconnected rows are kept, so the
 * history of what was sent keeps its destination (8.1d).
 */
export const telegramDestinations = sqliteTable('telegram_destinations', {
  id: text().primaryKey().$defaultFn(() => newId()),
  /** Telegram's chat id (a signed 64-bit number, kept as text). Changes when a group becomes a supergroup. */
  chatId: text().notNull(),
  kind: text({ enum: DESTINATION_KINDS }).notNull(),
  title: text().notNull(),
  status: text({ enum: DESTINATION_STATUSES }).notNull().default('connected'),
  connectedBy: text().references(() => authSchema!.user.id, { onDelete: 'set null' }),
  connectedAt: instant().notNull().default(nowMs),
  lastSentAt: instant(),
  blockedAt: instant(),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  uniqueIndex('telegram_destinations_chat_idx').on(t.chatId),
  index('telegram_destinations_status_idx').on(t.status),
  check('telegram_destinations_kind_check', sql`${t.kind} in ('private', 'group')`),
  check('telegram_destinations_status_check', sql`${t.status} in ('connected', 'blocked', 'disconnected')`),
])

/**
 * A one-time link an admin opens in Telegram to connect a chat. The code in the link is random
 * and only its hash is stored; it works once, for `TELEGRAM_LINK_MINUTES`. A group waits in
 * `confirm` (with the chat it came from) until the admin confirms it in the portal.
 */
export const telegramLinks = sqliteTable('telegram_links', {
  id: text().primaryKey().$defaultFn(() => newId()),
  codeHash: text().notNull(),
  kind: text({ enum: DESTINATION_KINDS }).notNull(),
  status: text({ enum: TELEGRAM_LINK_STATUSES }).notNull().default('waiting'),
  createdBy: text().notNull().references(() => authSchema!.user.id, { onDelete: 'cascade' }),
  expiresAt: instant().notNull(),
  /** The chat that used the link. */
  chatId: text(),
  chatTitle: text(),
  memberCount: integer(),
  destinationId: text().references(() => telegramDestinations.id, { onDelete: 'set null' }),
  createdAt: instant().notNull().default(nowMs),
}, t => [
  uniqueIndex('telegram_links_code_idx').on(t.codeHash),
  index('telegram_links_expires_idx').on(t.expiresAt),
  check('telegram_links_kind_check', sql`${t.kind} in ('private', 'group')`),
  check('telegram_links_status_check', sql`${t.status} in ('waiting', 'confirm', 'connected', 'cancelled', 'expired')`),
])

/**
 * Which chat receives which notification (step 8.1d, D113): a row means "on". Closing summaries can
 * also carry the day's CSV. A chat's rules stay while it's blocked or disconnected (nothing is sent
 * there meanwhile) and apply again when it's reconnected.
 */
export const notificationRules = sqliteTable('notification_rules', {
  kind: text({ enum: NOTIFICATION_KINDS }).notNull(),
  destinationId: text().notNull().references(() => telegramDestinations.id, { onDelete: 'cascade' }),
  attachCsv: integer({ mode: 'boolean' }).notNull().default(false),
  createdBy: text().references(() => authSchema!.user.id, { onDelete: 'set null' }),
  createdAt: instant().notNull().default(nowMs),
}, t => [
  primaryKey({ columns: [t.kind, t.destinationId] }),
  check('notification_rules_kind_check', sql`${t.kind} in ('new_order', 'payment', 'closing_summary')`),
])

/**
 * One message to one chat, saved before it's sent (step 8.1d, D113): the text (and a closing
 * summary's CSV) is a snapshot, so a retry sends the same thing. `dedupe_key` names what it's about
 * (`new_order:<orderId>`, `closing_summary:<branchId>:<date>`): one per chat, whatever repeats.
 * Sent by `notifications:deliver` every minute: at least once, a retry after a lost answer can
 * repeat a message (Telegram has no idempotency key).
 */
export const notificationDeliveries = sqliteTable('notification_deliveries', {
  id: text().primaryKey().$defaultFn(() => newId()),
  kind: text({ enum: [...NOTIFICATION_KINDS, 'report'] }).notNull(),
  destinationId: text().notNull().references(() => telegramDestinations.id, { onDelete: 'restrict' }),
  dedupeKey: text().notNull(),
  subject: text().notNull(),
  message: text({ mode: 'json' }).$type<StoredMessage>().notNull(),
  status: text({ enum: DELIVERY_STATUSES }).notNull().default('pending'),
  attempts: integer().notNull().default(0),
  nextAttemptAt: instant().notNull().default(nowMs),
  lastError: text(),
  createdAt: instant().notNull().default(nowMs),
  sentAt: instant(),
}, t => [
  uniqueIndex('notification_deliveries_dedupe_idx').on(t.destinationId, t.dedupeKey),
  index('notification_deliveries_due_idx').on(t.status, t.nextAttemptAt),
  index('notification_deliveries_created_idx').on(t.createdAt),
  check('notification_deliveries_status_check', sql`${t.status} in ('pending', 'sent', 'failed')`),
])

/** A saved message: Telegram HTML, a link button, a file sent after it. */
export interface StoredMessage {
  html: string
  button?: { text: string, url: string }
  document?: { filename: string, content: string }
}
