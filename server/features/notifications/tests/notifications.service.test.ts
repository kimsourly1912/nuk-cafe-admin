import { Api } from 'grammy'
import type { Update } from 'grammy/types'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '../../identity'
import { telegramDestinations, telegramLinks } from '../notifications.schema'
import { cancelLink, confirmLink, createLink, disconnectDestination, getLink, handleUpdate, sendReport, sendTestMessage, telegramOverview } from '../notifications.service'
import { chatTitle, hashLinkCode, secretMatches, startCode } from '../notifications.rules'
import type { TelegramSettings } from '../notifications.settings'
import { telegramSettingsFrom } from '../notifications.settings'
import { createAdmin, createTestDb } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import { interleaved } from '../../../tests/support/interleave'
import type { Db } from '../../../utils/batch'

// Telegram (step 8.1c, D112) against the migrations, with grammY's real `Api` talking to a fake
// Telegram through its `fetch` option: every call the bot makes is recorded and answered here.

const SETTINGS: TelegramSettings = { botToken: '123:test', botUsername: 'NukCafeBot', webhookSecret: 's'.repeat(40) }

interface Call { method: string, payload: Record<string, unknown> | null }
type Answer = { ok: true, result: unknown } | { ok: false, error_code: number, description: string, parameters?: Record<string, unknown> }

class FakeTelegram {
  calls: Call[] = []
  answers: Record<string, (payload: Record<string, unknown> | null) => Answer> = {}
  readonly api = new Api(SETTINGS.botToken, {
    fetch: (async (url: string | URL, init?: { body?: unknown }) => {
      const method = String(url).split('/').pop()!
      const payload = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
      this.calls.push({ method, payload })
      const answer = this.answers[method]?.(payload) ?? { ok: true, result: method === 'getChatMemberCount' ? 8 : true }
      return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch,
  })

  sent = (method = 'sendMessage') => this.calls.filter(c => c.method === method)
  lastText = () => this.sent().at(-1)?.payload?.text as string | undefined
}

let db: Db
let telegram: FakeTelegram
let admin: Actor
let otherAdmin: Actor
const now = new Date('2026-09-30T05:00:00Z')
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)

let updateId = 1
const privateChat = { id: 555, type: 'private' as const, first_name: 'Sokha', last_name: 'Chan' }
const group = { id: -100200, type: 'supergroup' as const, title: 'NUK Riverside Staff' }
const person = { id: 555, is_bot: false, first_name: 'Sokha' }

function message(chat: Update['message'] extends infer M ? M extends { chat: infer C } ? C : never : never, text: string, from = person): Update {
  return { update_id: updateId++, message: { message_id: updateId, date: 0, chat, from, text } } as Update
}

/** The code in a link's URL (the database only has its hash). */
const codeOf = (url: string) => new URL(url).searchParams.get('start') ?? new URL(url).searchParams.get('startgroup')!

beforeEach(async () => {
  db = await createTestDb()
  telegram = new FakeTelegram()
  admin = { userId: (await createAdmin(db)).userId, role: 'admin' }
  otherAdmin = { userId: (await createAdmin(db)).userId, role: 'admin' }
})

describe('settings and rules', () => {
  it('is off without a token, and refuses a half-set one', async () => {
    expect(telegramSettingsFrom({})).toBeNull()
    expect(telegramSettingsFrom({ botToken: '1:x', botUsername: '@NukCafeBot', webhookSecret: 'a'.repeat(32) })).toEqual({ botToken: '1:x', botUsername: 'NukCafeBot', webhookSecret: 'a'.repeat(32) })
    await expectApiError(() => telegramSettingsFrom({ botToken: '1:x', webhookSecret: 'a'.repeat(32) }), 500, 'TELEGRAM_NOT_CONFIGURED')
    await expectApiError(() => telegramSettingsFrom({ botToken: '1:x', botUsername: 'NukCafeBot', webhookSecret: 'short' }), 500, 'TELEGRAM_NOT_CONFIGURED')
    expect(await telegramOverview(db, null)).toEqual({ enabled: false, botUsername: null, destinations: [], rules: [] })
  })

  it('reads start codes and compares the webhook secret', () => {
    expect(startCode('/start abc-DEF_1', 'NukCafeBot')).toBe('abc-DEF_1')
    expect(startCode('/start@nukcafebot abc', 'NukCafeBot')).toBe('abc')
    expect(startCode('/start@OtherBot abc', 'NukCafeBot')).toBeNull()
    expect(startCode('/start', 'NukCafeBot')).toBeNull()
    expect(startCode('/start a b', 'NukCafeBot')).toBeNull()
    expect(secretMatches(SETTINGS.webhookSecret, SETTINGS.webhookSecret)).toBe(true)
    expect(secretMatches(`${SETTINGS.webhookSecret}x`, SETTINGS.webhookSecret)).toBe(false)
    expect(secretMatches(undefined, SETTINGS.webhookSecret)).toBe(false)
    expect(chatTitle(privateChat)).toBe('Sokha Chan')
    expect(chatTitle(group)).toBe('NUK Riverside Staff')
  })
})

describe('connecting a private chat', () => {
  it('connects the chat that opened the link; the code works once and is never stored', async () => {
    const link = await createLink(db, admin, SETTINGS, { kind: 'private' }, now)
    expect(link.url).toMatch(/^https:\/\/t\.me\/NukCafeBot\?start=[\w-]{43}$/)
    const code = codeOf(link.url)
    const [row] = await db.select().from(telegramLinks)
    expect(row!.codeHash).toBe(await hashLinkCode(code))
    expect(JSON.stringify(row)).not.toContain(code)

    await handleUpdate(db, telegram.api, SETTINGS, message(privateChat, `/start ${code}`), later(1))
    expect(telegram.lastText()).toMatch(/^Connected/)
    const connected = await getLink(db, admin, link.id, later(1))
    expect(connected.status).toBe('connected')
    const overview = await telegramOverview(db, SETTINGS)
    expect(overview.destinations).toMatchObject([{ kind: 'private', title: 'Sokha Chan', status: 'connected', connectedBy: 'Admin' }])

    // Telegram resends the update, or someone reuses the link: nothing new is connected.
    await handleUpdate(db, telegram.api, SETTINGS, message(privateChat, `/start ${code}`), later(2))
    expect(telegram.lastText()).toMatch(/doesn't work anymore/)
    expect(await db.select().from(telegramDestinations)).toHaveLength(1)
  })

  it('two chats racing with one code: only one is connected (the link\'s guard)', async () => {
    const link = await createLink(db, admin, SETTINGS, { kind: 'private' }, now)
    const start = `/start ${codeOf(link.url)}`
    const other = { ...privateChat, id: 777, first_name: 'Dara' }
    // Dara's update is handled after Sokha's checked the link and before it writes.
    const racing = interleaved(db, () => handleUpdate(db, telegram.api, SETTINGS, message(other, start), later(1)))
    await handleUpdate(racing, telegram.api, SETTINGS, message(privateChat, start), later(1))
    expect(await db.select().from(telegramDestinations)).toMatchObject([{ title: 'Dara Chan' }])
  })

  it('refuses an expired link, a group\'s link in a private chat, and another admin\'s link status', async () => {
    const link = await createLink(db, admin, SETTINGS, { kind: 'private' }, now)
    await handleUpdate(db, telegram.api, SETTINGS, message(privateChat, `/start ${codeOf(link.url)}`), later(11))
    expect(telegram.lastText()).toMatch(/doesn't work anymore/)
    expect((await getLink(db, admin, link.id, later(11))).status).toBe('expired')
    await expectApiError(() => getLink(db, otherAdmin, link.id, now), 404, 'NOT_FOUND')

    const groupLink = await createLink(db, admin, SETTINGS, { kind: 'group' }, now)
    await handleUpdate(db, telegram.api, SETTINGS, message(privateChat, `/start ${codeOf(groupLink.url)}`), later(1))
    expect(telegram.lastText()).toMatch(/for a group/)
    expect(await db.select().from(telegramDestinations)).toHaveLength(0)
  })
})

describe('connecting a group', () => {
  it('needs a group admin, then the portal\'s confirmation', async () => {
    const link = await createLink(db, admin, SETTINGS, { kind: 'group' }, now)
    expect(link.url).toContain('?startgroup=')
    const start = `/start@NukCafeBot ${codeOf(link.url)}`

    telegram.answers.getChatMember = () => ({ ok: true, result: { status: 'member', user: person } })
    await handleUpdate(db, telegram.api, SETTINGS, message(group, start), later(1))
    expect(telegram.lastText()).toMatch(/Only an admin/)
    expect((await getLink(db, admin, link.id, later(1))).status).toBe('waiting')

    telegram.answers.getChatMember = () => ({ ok: true, result: { status: 'administrator', user: person } })
    await handleUpdate(db, telegram.api, SETTINGS, message(group, start), later(2))
    expect(telegram.lastText()).toMatch(/confirm this group/)
    expect(await getLink(db, admin, link.id, later(2))).toMatchObject({ status: 'confirm', chat: { title: 'NUK Riverside Staff', memberCount: 8 } })
    expect(await db.select().from(telegramDestinations)).toHaveLength(0)

    await expectApiError(() => confirmLink(db, otherAdmin, link.id, later(3)), 404, 'NOT_FOUND')
    const destination = await confirmLink(db, admin, link.id, later(3))
    expect(destination).toMatchObject({ kind: 'group', title: 'NUK Riverside Staff', status: 'connected' })
    await expectApiError(() => confirmLink(db, admin, link.id, later(3)), 409, 'TELEGRAM_LINK_UNUSABLE')
  })

  it('a confirmation after the link expired is refused', async () => {
    const link = await createLink(db, admin, SETTINGS, { kind: 'group' }, now)
    telegram.answers.getChatMember = () => ({ ok: true, result: { status: 'creator', user: person } })
    await handleUpdate(db, telegram.api, SETTINGS, message(group, `/start@NukCafeBot ${codeOf(link.url)}`), later(1))
    await expectApiError(() => confirmLink(db, admin, link.id, later(11)), 409, 'TELEGRAM_LINK_UNUSABLE')
  })

  it('cancelling a group waiting for confirmation makes the bot leave it', async () => {
    const link = await createLink(db, admin, SETTINGS, { kind: 'group' }, now)
    telegram.answers.getChatMember = () => ({ ok: true, result: { status: 'creator', user: person } })
    await handleUpdate(db, telegram.api, SETTINGS, message(group, `/start@NukCafeBot ${codeOf(link.url)}`), later(1))
    expect((await cancelLink(db, telegram.api, admin, link.id, later(2))).status).toBe('cancelled')
    expect(telegram.sent('leaveChat')).toMatchObject([{ payload: { chat_id: '-100200' } }])
  })
})

async function connectedGroup() {
  const link = await createLink(db, admin, SETTINGS, { kind: 'group' }, now)
  telegram.answers.getChatMember = () => ({ ok: true, result: { status: 'creator', user: person } })
  await handleUpdate(db, telegram.api, SETTINGS, message(group, `/start@NukCafeBot ${codeOf(link.url)}`), later(1))
  return confirmLink(db, admin, link.id, later(2))
}

describe('chats', () => {
  it('a removed bot marks the chat blocked; a supergroup upgrade keeps it', async () => {
    const destination = await connectedGroup()
    await handleUpdate(db, telegram.api, SETTINGS, { update_id: updateId++, message: { message_id: 1, date: 0, chat: { id: -100200, type: 'group', title: 'NUK Riverside Staff' }, migrate_to_chat_id: -100999 } } as Update, later(3))
    const [moved] = await db.select().from(telegramDestinations)
    expect(moved!.chatId).toBe('-100999')

    await handleUpdate(db, telegram.api, SETTINGS, {
      update_id: updateId++,
      my_chat_member: { chat: { id: -100999, type: 'supergroup', title: 'NUK Riverside Staff' }, from: person, date: 0, old_chat_member: { status: 'member', user: person }, new_chat_member: { status: 'kicked', user: person, until_date: 0 } },
    } as Update, later(4))
    const overview = await telegramOverview(db, SETTINGS)
    expect(overview.destinations).toMatchObject([{ id: destination.id, status: 'blocked' }])
    await expectApiError(() => sendTestMessage(db, telegram.api, admin, destination.id, later(5)), 409, 'TELEGRAM_BLOCKED')
  })

  it('Send test sends; Telegram refusing marks it blocked, a rate limit asks to wait', async () => {
    const destination = await connectedGroup()
    const tested = await sendTestMessage(db, telegram.api, admin, destination.id, later(3))
    expect(tested.lastSentAt).toBe(later(3).toISOString())
    expect(telegram.sent().at(-1)!.payload).toMatchObject({ chat_id: '-100200', parse_mode: 'HTML' })

    telegram.answers.sendMessage = () => ({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } })
    await expectApiError(() => sendTestMessage(db, telegram.api, admin, destination.id, later(4)), 429, 'TELEGRAM_RATE_LIMITED', undefined, 'Telegram asks to wait 7 seconds. Try again then.')
    telegram.answers.sendMessage = () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the supergroup chat' })
    await expectApiError(() => sendTestMessage(db, telegram.api, admin, destination.id, later(5)), 409, 'TELEGRAM_BLOCKED')
    expect((await telegramOverview(db, SETTINGS)).destinations[0]!.status).toBe('blocked')
  })

  it('disconnects with the version it saw; the bot leaves a group; reconnecting brings the chat back', async () => {
    const destination = await connectedGroup()
    await expectApiError(() => disconnectDestination(db, telegram.api, admin, destination.id, destination.version + 1, later(3)), 409, 'VERSION_CONFLICT')
    await disconnectDestination(db, telegram.api, admin, destination.id, destination.version, later(3))
    expect(telegram.sent('leaveChat')).toHaveLength(1)
    expect((await telegramOverview(db, SETTINGS)).destinations).toEqual([])

    const again = await connectedGroup()
    expect(again.id).toBe(destination.id)
    expect(again.status).toBe('connected')
  })
})

describe('sending a report', () => {
  const build = (attach = false) => async () => ({ subject: 'Summary · Wed 30 Sep 2026', html: '<b>Summary · Riverside</b>', document: attach ? { filename: 'riverside-2026-09-30-summary.csv', content: '﻿a,b\r\n' } : undefined, audit: { report: 'summary' } })

  it('sends once per key: a retry after a lost answer doesn\'t send twice', async () => {
    const destination = await connectedGroup()
    const request = { destinationId: destination.id, report: { kind: 'summary' }, attachCsv: true }
    const key = crypto.randomUUID()
    const before = telegram.sent().length // the bot's replies while connecting
    const first = await sendReport(db, telegram.api, admin, key, request, build(true), later(3))
    expect(first).toEqual({ destination: { id: destination.id, title: 'NUK Riverside Staff' }, sentAt: later(3).toISOString() })
    expect(telegram.sent()).toHaveLength(before + 1)
    expect(telegram.sent('sendDocument')).toHaveLength(1)

    expect(await sendReport(db, telegram.api, admin, key, request, build(true), later(4))).toEqual(first)
    expect(telegram.sent()).toHaveLength(before + 1)
    await sendReport(db, telegram.api, admin, crypto.randomUUID(), request, build(), later(5))
    expect(telegram.sent()).toHaveLength(before + 2)
  })

  it('a failed send can be tried again with the same key', async () => {
    const destination = await connectedGroup()
    const request = { destinationId: destination.id, report: { kind: 'summary' }, attachCsv: false }
    const key = crypto.randomUUID()
    const before = telegram.sent().length
    telegram.answers.sendMessage = () => ({ ok: false, error_code: 500, description: 'Internal Server Error' })
    await expectApiError(() => sendReport(db, telegram.api, admin, key, request, build(), later(3)), 424, 'TELEGRAM_UNAVAILABLE')
    delete telegram.answers.sendMessage
    await sendReport(db, telegram.api, admin, key, request, build(), later(4))
    expect(telegram.sent()).toHaveLength(before + 2)
    const [row] = await db.select().from(telegramDestinations).where(eq(telegramDestinations.id, destination.id))
    expect(row!.lastSentAt).toEqual(later(4))
  })

  it('an unknown or disconnected chat is 404', async () => {
    const destination = await connectedGroup()
    await disconnectDestination(db, telegram.api, admin, destination.id, destination.version, later(3))
    await expectApiError(() => sendReport(db, telegram.api, admin, crypto.randomUUID(), { destinationId: destination.id, report: {}, attachCsv: false }, build(), later(4)), 404, 'NOT_FOUND')
  })
})
