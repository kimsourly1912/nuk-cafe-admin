import * as v from 'valibot'
import { idSchema, versionSchema } from './common'

/**
 * Marketing channels and posts (step M2a, D164): the cafe's own Telegram channel, connected once,
 * and a promotion posted there (its poster, a caption and an Order now button), now or at a time.
 * `/api/admin/marketing/…`. Facebook Pages join as another kind of channel in M2b.
 */

export const CHANNEL_KINDS = ['telegram_channel'] as const
export type ChannelKind = typeof CHANNEL_KINDS[number]

/** `removed`: the bot is no longer an admin of the channel (removed by someone): reconnect it. */
export const CHANNEL_STATUSES = ['connected', 'removed', 'disconnected'] as const
export type ChannelStatus = typeof CHANNEL_STATUSES[number]

export interface MarketingChannel {
  id: string
  kind: ChannelKind
  title: string
  /** `@name` of a public channel; `null` for a private one. */
  username: string | null
  /** Subscribers when it was connected. */
  subscriberCount: number | null
  status: Exclude<ChannelStatus, 'disconnected'>
  connectedBy: string | null
  connectedAt: string
  version: number
}

/** How long a channel's connect code works. */
export const CHANNEL_LINK_MINUTES = 15

export const CHANNEL_LINK_STATUSES = ['waiting', 'confirm', 'connected', 'cancelled', 'expired'] as const
export type ChannelLinkStatus = typeof CHANNEL_LINK_STATUSES[number]

/** Connecting a channel: add the bot as its admin, post the code there, confirm here. */
export interface ChannelLink {
  id: string
  status: ChannelLinkStatus
  expiresAt: string
  /** The channel the code was posted in (`confirm` onwards). */
  channel: { title: string, username: string | null, subscriberCount: number | null } | null
  channelId: string | null
}

export interface NewChannelLink extends ChannelLink {
  /** What to post in the channel: `/connect ABCD2345EF`. Only in this answer. */
  command: string
  /** Opens Telegram to add the bot to a channel as an admin that can post. */
  addBotUrl: string
  botUsername: string
}

/** The `/connect` code: 10 characters of base32, easy to copy and impossible to guess in 15 minutes. */
export const CHANNEL_CODE_PATTERN = /^[A-Z2-7]{10}$/

// --- Posts ---

export const POST_STATUSES = ['pending', 'sent', 'failed', 'cancelled'] as const
export type PostStatus = typeof POST_STATUSES[number]

/** Telegram allows 1,024 characters under a photo; the menu link is a button, not in the text. */
export const POST_CAPTION_MAX = 1000
/** How far ahead a post can be scheduled. */
export const POST_SCHEDULE_MAX_DAYS = 30
/** Tries before a post is given up on (Telegram's "wait" doesn't count). */
export const POST_MAX_ATTEMPTS = 5

export interface MarketingPost {
  id: string
  promotionId: string
  channel: { id: string, title: string, kind: ChannelKind }
  /**
   * `pending`: waiting for its time (`scheduledAt`), or being sent / retried (`attempts` > 0).
   * `cancelled`: by an admin before it went out, or because the promotion ended first.
   */
  status: PostStatus
  caption: string
  withPoster: boolean
  scheduledAt: string
  attempts: number
  sentAt: string | null
  /** The post in the channel (`t.me/<channel>/<id>`), once sent. */
  url: string | null
  /** Why it failed or was cancelled, safe to show. */
  reason: string | null
  createdBy: string | null
  createdAt: string
  version: number
}

/**
 * `POST …/promotions/{id}/posts` (header `Idempotency-Key`): one post per channel. `at`: when
 * (ISO 8601); omitted or `null`: now. Only a scheduled or live promotion can be posted.
 */
export const createPostsSchema = v.strictObject({
  channelIds: v.pipe(v.array(idSchema), v.minLength(1, 'Choose at least one channel'), v.maxLength(10), v.check(ids => new Set(ids).size === ids.length, 'Each channel once')),
  caption: v.pipe(v.string(), v.trim(), v.minLength(1, 'Write a caption'), v.maxLength(POST_CAPTION_MAX, `At most ${POST_CAPTION_MAX} characters`)),
  withPoster: v.optional(v.boolean(), true),
  at: v.optional(v.nullable(v.pipe(v.string(), v.isoTimestamp('A date and time'))), null),
})
export type CreatePostsInput = v.InferOutput<typeof createPostsSchema>

export const postVersionSchema = v.strictObject({ version: versionSchema })
export type PostVersionInput = v.InferOutput<typeof postVersionSchema>

export const channelVersionSchema = v.strictObject({ version: versionSchema })

// --- Where orders came from ---

/**
 * An order placed after opening a post's link (`?src=telegram`): kept on the order (D164) so a
 * promotion's page can say how many came from each channel.
 */
export const ORDER_SOURCES = ['telegram', 'facebook'] as const
export type OrderSource = typeof ORDER_SOURCES[number]

/** The menu link a post's button opens: the cafe's menu with the offer open, marked as from the channel. */
export function postMenuUrl(cafeUrl: string, promotionId: string, source: OrderSource): string {
  return `${cafeUrl.replace(/\/+$/, '')}?promo=${encodeURIComponent(promotionId)}&src=${source}`
}

/** A caption to start from: the name with the badge, the description, the last day. */
export function defaultCaption(promotion: { name: string, label: string, description: string, endsOn: string | null }): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const until = promotion.endsOn ? `Until ${Number(promotion.endsOn.slice(8, 10))} ${months[Number(promotion.endsOn.slice(5, 7)) - 1]}.` : ''
  return [`${promotion.name}: ${promotion.label}`, promotion.description, until].filter(Boolean).join('\n\n')
}

/** `GET /api/admin/marketing/channels`: whether this server has a Telegram bot, and the cafe's channels. */
export interface MarketingChannels {
  telegram: { enabled: boolean, botUsername: string | null }
  channels: MarketingChannel[]
}
