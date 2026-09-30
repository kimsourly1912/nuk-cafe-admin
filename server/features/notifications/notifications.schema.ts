import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { DESTINATION_KINDS, DESTINATION_STATUSES, TELEGRAM_LINK_STATUSES } from '#shared/contracts/notifications'
import { newId } from '../../utils/ids'

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
