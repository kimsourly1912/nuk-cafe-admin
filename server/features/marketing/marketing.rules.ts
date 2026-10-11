import type { Chat } from 'grammy/types'

/** Marketing's pure rules (step M2a, D164): connect codes, channel links and post addresses. */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** A `/connect` code: 10 base32 characters (50 random bits), posted once within 15 minutes. */
export function newChannelCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return [...bytes].map(byte => BASE32[byte % 32]).join('')
}

/** Only the hash is stored: the database never holds a working code. */
export async function hashChannelCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toUpperCase()))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The code in a channel post: `/connect ABCD2345EF` (or `/connect@<bot> …`), any case, nothing
 * else in the post. Another bot's command is not ours.
 */
export function connectCode(text: string | undefined, botUsername: string): string | null {
  const match = /^\s*\/connect(?:@(\w+))?\s+([a-z2-7]{10})\s*$/i.exec(text ?? '')
  if (!match) return null
  if (match[1] && match[1].toLowerCase() !== botUsername.toLowerCase()) return null
  return match[2]!.toUpperCase()
}

/** Opens Telegram's "add to channel" with the rights the bot needs: post, and delete the code. */
export const addBotUrl = (botUsername: string) => `https://t.me/${botUsername}?startchannel&admin=post_messages+delete_messages`

export const isChannel = (chat: Pick<Chat, 'type'>) => chat.type === 'channel'

/**
 * A post's address: `t.me/<name>/<id>` for a public channel, `t.me/c/<id>/<id>` for a private one
 * (its chat id without the `-100`).
 */
export function postUrl(channel: { externalId: string, username: string | null }, messageId: number): string {
  if (channel.username) return `https://t.me/${channel.username}/${messageId}`
  return `https://t.me/c/${channel.externalId.replace(/^-100/, '')}/${messageId}`
}

/** Telegram's HTML: only `&`, `<` and `>` need escaping in text. */
export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
