import { GrammyError } from 'grammy'
import type { Chat } from 'grammy/types'
import type { DestinationKind } from '#shared/contracts/notifications'
import { destinationBlocked, telegramRateLimited, telegramUnavailable } from './notifications.errors'

/** Pure rules of Telegram (step 8.1c, D112). */

/**
 * A connect code: 32 random bytes as base64url (43 characters). Telegram passes it back in
 * `/start <code>`, which allows 1–64 characters of A–Z, a–z, 0–9, _ and -.
 */
export function newLinkCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Only the hash is stored: the database never holds a working code. */
export async function hashLinkCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** `t.me/<bot>?start=<code>` opens a private chat; `?startgroup=<code>` asks for a group to add the bot to. */
export function linkUrl(botUsername: string, kind: DestinationKind, code: string): string {
  return `https://t.me/${botUsername}?${kind === 'private' ? 'start' : 'startgroup'}=${code}`
}

/**
 * The code in a `/start` message: `/start <code>` in a private chat, `/start@<bot> <code>` in a
 * group (Telegram adds the bot's name there). Another bot's `/start` is not ours.
 */
export function startCode(text: string | undefined, botUsername: string): string | null {
  const match = /^\/start(?:@(\w+))?\s+([\w-]{1,64})\s*$/.exec(text ?? '')
  if (!match) return null
  if (match[1] && match[1].toLowerCase() !== botUsername.toLowerCase()) return null
  return match[2]!
}

export const isGroup = (chat: Pick<Chat, 'type'>) => chat.type === 'group' || chat.type === 'supergroup'

/** A group's title, or a person's name (first and last, else the username). */
export function chatTitle(chat: Chat): string {
  if ('title' in chat && chat.title) return chat.title
  const name = 'first_name' in chat ? [chat.first_name, 'last_name' in chat ? chat.last_name : undefined].filter(Boolean).join(' ') : ''
  if (name) return name
  return 'username' in chat && chat.username ? `@${chat.username}` : 'Telegram chat'
}

/** Compares the webhook's secret header in constant time. */
export function secretMatches(received: string | undefined, expected: string): boolean {
  if (!received) return false
  const a = new TextEncoder().encode(received)
  const b = new TextEncoder().encode(expected)
  let difference = a.length ^ b.length
  for (let i = 0; i < b.length; i++) difference |= (a[i] ?? 0) ^ b[i]!
  return difference === 0
}

/** Telegram's answers that mean the chat is gone for the bot: removed, blocked, deleted. */
export function isBlockedError(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false
  if (error.error_code === 403) return true
  return error.error_code === 400 && /chat not found|group chat was deactivated|not enough rights|have no rights/i.test(error.description)
}

/**
 * A failed send as the API's error: blocked (409, the chat is then marked blocked), rate limited
 * (503 with Telegram's wait), anything else 502. The cause goes to the log, not the screen.
 */
export function sendFailure(error: unknown, title: string) {
  if (isBlockedError(error)) return destinationBlocked(title)
  if (error instanceof GrammyError && error.error_code === 429) return telegramRateLimited(error.parameters.retry_after ?? 30)
  return telegramUnavailable()
}

/** Telegram's HTML: only `&`, `<` and `>` need escaping in text. */
export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A message as plain text (previews, the delivery history): tags removed, entities back to text. */
export const plainText = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
