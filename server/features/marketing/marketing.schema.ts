import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { schema as authSchema } from '#auth/schema'
import { CHANNEL_KINDS, CHANNEL_LINK_STATUSES, CHANNEL_STATUSES, POST_STATUSES } from '#shared/contracts/marketing'
import { newId } from '#server/utils/ids'
import { tenantId } from '#server/features/branches/branches.schema'
import { menuPromotions } from '#server/features/menu/menu.schema'

/**
 * Marketing (step M2a, D164): the cafe's channels (a Telegram channel; a Facebook Page in M2b), the
 * one-time codes that connect them, and the posts of a promotion to them. Every row belongs to a
 * tenant; links between them are composite foreign keys inside it. Registered with NuxtHub through
 * the `hub:db:schema:extend` hook.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })

/**
 * A channel a promotion can be posted to. One row per tenant, kind and channel: reconnecting brings
 * it back. Never deleted (its posts point at it): disconnected ones are hidden.
 */
export const marketingChannels = sqliteTable('marketing_channels', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  kind: text({ enum: CHANNEL_KINDS }).notNull(),
  /** Telegram's chat id (a signed 64-bit number, as text). */
  externalId: text().notNull(),
  title: text().notNull(),
  username: text(),
  subscriberCount: integer(),
  status: text({ enum: CHANNEL_STATUSES }).notNull().default('connected'),
  connectedBy: text().references(() => authSchema!.user.id, { onDelete: 'set null' }),
  connectedAt: instant().notNull(),
  removedAt: instant(),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  uniqueIndex('marketing_channels_external_idx').on(t.tenantId, t.kind, t.externalId),
  unique('marketing_channels_tenant_id_unique').on(t.tenantId, t.id),
  // The webhook finds a channel by Telegram's id, whichever cafe it belongs to.
  index('marketing_channels_external_id_idx').on(t.externalId),
  check('marketing_channels_kind_check', sql`${t.kind} in ('telegram_channel')`),
  check('marketing_channels_status_check', sql`${t.status} in ('connected', 'removed', 'disconnected')`),
])

/**
 * A one-time code an admin posts in a channel to connect it (`/connect <code>`): only its hash is
 * kept, it works once, for 15 minutes. The channel it was posted in waits in `confirm` until the
 * admin confirms it in the portal.
 */
export const marketingChannelLinks = sqliteTable('marketing_channel_links', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  codeHash: text().notNull(),
  status: text({ enum: CHANNEL_LINK_STATUSES }).notNull().default('waiting'),
  createdBy: text().notNull().references(() => authSchema!.user.id, { onDelete: 'cascade' }),
  expiresAt: instant().notNull(),
  chatId: text(),
  chatTitle: text(),
  chatUsername: text(),
  memberCount: integer(),
  channelId: text(),
  createdAt: instant().notNull().default(nowMs),
}, t => [
  foreignKey({ name: 'marketing_channel_links_channel_fk', columns: [t.tenantId, t.channelId], foreignColumns: [marketingChannels.tenantId, marketingChannels.id] }).onDelete('restrict'),
  uniqueIndex('marketing_channel_links_code_idx').on(t.codeHash),
  index('marketing_channel_links_expires_idx').on(t.expiresAt),
  check('marketing_channel_links_status_check', sql`${t.status} in ('waiting', 'confirm', 'connected', 'cancelled', 'expired')`),
])

/** What a post sends, kept as it was queued: a retry sends the same thing. */
export interface PostMessage {
  /** Telegram HTML, escaped. */
  html: string
  /** The poster's stored object (`t/<tenant>/menu/<id>.png`), sent as the photo. */
  photoKey?: string
  button: { text: string, url: string }
}

/**
 * A promotion posted to one channel, now or at `scheduled_at`. Sent by `marketing:deliver-posts`
 * every minute (and right after a Post now), at least once: a lost answer after Telegram accepted
 * it can repeat the post.
 */
export const marketingPosts = sqliteTable('marketing_posts', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  promotionId: text().notNull(),
  channelId: text().notNull(),
  status: text({ enum: POST_STATUSES }).notNull().default('pending'),
  /** The caption as the admin wrote it (plain text); `message` holds what goes to Telegram. */
  caption: text().notNull(),
  message: text({ mode: 'json' }).$type<PostMessage>().notNull(),
  scheduledAt: instant().notNull(),
  attempts: integer().notNull().default(0),
  nextAttemptAt: instant().notNull(),
  externalMessageId: text(),
  externalUrl: text(),
  reason: text(),
  createdBy: text().references(() => authSchema!.user.id, { onDelete: 'set null' }),
  createdAt: instant().notNull().default(nowMs),
  sentAt: instant(),
  version: integer().notNull().default(1),
}, t => [
  // A promotion is deleted only as a draft (never posted) or by a sample-data reset.
  foreignKey({ name: 'marketing_posts_promotion_fk', columns: [t.tenantId, t.promotionId], foreignColumns: [menuPromotions.tenantId, menuPromotions.id] }).onDelete('cascade'),
  foreignKey({ name: 'marketing_posts_channel_fk', columns: [t.tenantId, t.channelId], foreignColumns: [marketingChannels.tenantId, marketingChannels.id] }).onDelete('restrict'),
  index('marketing_posts_due_idx').on(t.status, t.nextAttemptAt),
  index('marketing_posts_promotion_idx').on(t.tenantId, t.promotionId, t.scheduledAt),
  check('marketing_posts_status_check', sql`${t.status} in ('pending', 'sent', 'failed', 'cancelled')`),
])
