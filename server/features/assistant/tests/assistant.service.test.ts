import { eq } from 'drizzle-orm'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '../../identity'
import { assistantUsage } from '../assistant.schema'
import { languageModel } from '../assistant.model'
import { pingAssistant, purgeAssistantUsage, startUsage } from '../assistant.service'
import type { AssistantSettings } from '../assistant.settings'
import { assistantSettingsFrom } from '../assistant.settings'
import { createTestDb, createUser } from '../../../tests/support/db'
import { expectApiError } from '../../../tests/support/failure'
import type { Db } from '../../../utils/batch'

// The assistant's groundwork (step 9.0, D108) against the migrations: settings, the provider
// choice, the daily limit per admin (guarded in the batch), usage records and their cleanup. The
// AI SDK's test model stands in for the provider: no test calls a real one.

let db: Db
let sokha: Actor
let dara: Actor
const settings: AssistantSettings = { provider: 'anthropic', model: 'claude-test', apiKey: 'test-key', baseUrl: null, dailyLimit: 2 }

/** 2026-09-30 in Phnom Penh (UTC+7). */
const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00+07:00`)

const rows = () => db.select().from(assistantUsage)

beforeEach(async () => {
  db = await createTestDb()
  sokha = { userId: (await createUser(db)).id, role: 'admin' }
  dara = { userId: (await createUser(db)).id, role: 'admin' }
})

describe('settings (D108)', () => {
  it('is off without a key, whatever else is set', () => {
    expect(assistantSettingsFrom({ provider: 'openai', model: 'gpt-x', apiKey: '  ' })).toBeNull()
    expect(assistantSettingsFrom({})).toBeNull()
  })

  it('with a key, refuses incomplete settings instead of switching off', async () => {
    await expectApiError(() => assistantSettingsFrom({ provider: 'openia', model: 'm', apiKey: 'k' }), 500, 'AI_NOT_CONFIGURED')
    await expectApiError(() => assistantSettingsFrom({ provider: 'openai', model: ' ', apiKey: 'k' }), 500, 'AI_NOT_CONFIGURED', undefined, 'The assistant\'s settings are incomplete: NUXT_AI_MODEL is missing.')
    await expectApiError(() => assistantSettingsFrom({ provider: 'openai-compatible', model: 'm', apiKey: 'k' }), 500, 'AI_NOT_CONFIGURED')
  })

  it('reads the daily limit, falling back to 100 when it isn\'t a positive whole number', () => {
    const base = { provider: 'google', model: 'gem', apiKey: 'k' }
    expect(assistantSettingsFrom({ ...base, dailyLimit: '40' })?.dailyLimit).toBe(40)
    expect(assistantSettingsFrom({ ...base, dailyLimit: 0 })?.dailyLimit).toBe(100)
    expect(assistantSettingsFrom({ ...base, dailyLimit: 'lots' })?.dailyLimit).toBe(100)
    expect(assistantSettingsFrom(base)).toEqual({ provider: 'google', model: 'gem', apiKey: 'k', baseUrl: null, dailyLimit: 100 })
  })

  it('builds the provider the settings name, and only that one', () => {
    const model = (provider: AssistantSettings['provider'], baseUrl: string | null = null) => {
      const built = languageModel({ ...settings, provider, model: 'm', baseUrl })
      return typeof built === 'string' ? built : `${built.provider} ${built.modelId}`
    }
    expect(model('anthropic')).toBe('anthropic.messages m')
    expect(model('openai')).toBe('openai.responses m')
    expect(model('google')).toBe('google.generative-ai m')
    expect(model('openai-compatible', 'https://llm.example/v1')).toBe('openai-compatible.chat m')
  })
})

describe('the daily limit (D108)', () => {
  it('records each request in the admin\'s local day and refuses past the limit, per admin', async () => {
    await startUsage(db, sokha, settings, 'ping', at('09:00'))
    await startUsage(db, sokha, settings, 'ping', at('09:01'))
    await expectApiError(() => startUsage(db, sokha, settings, 'ping', at('09:02')), 429, 'AI_LIMIT_REACHED', undefined, 'You\'ve used today\'s 2 assistant requests. They reset at midnight.')
    // Someone else's day is their own.
    await expect(startUsage(db, dara, settings, 'ping', at('09:03'))).resolves.toBeTruthy()
    // Midnight in Phnom Penh (17:00 UTC) starts a new day.
    await expect(startUsage(db, sokha, settings, 'ping', new Date('2026-09-30T17:00:00Z'))).resolves.toBeTruthy()
    const mine = (await rows()).filter(r => r.userId === sokha.userId)
    expect(mine.map(r => [r.day, r.outcome, r.feature, r.provider, r.model]).sort()).toEqual([
      ['2026-09-30', 'pending', 'ping', 'anthropic', 'claude-test'],
      ['2026-09-30', 'pending', 'ping', 'anthropic', 'claude-test'],
      ['2026-10-01', 'pending', 'ping', 'anthropic', 'claude-test'],
    ])
  })

  it('two requests racing for the last slot: one passes', async () => {
    await startUsage(db, sokha, settings, 'ping', at('09:00'))
    const racer = racing(2)
    const results = await Promise.allSettled([
      startUsage(racer, sokha, settings, 'ping', at('09:01')),
      startUsage(racer, sokha, settings, 'ping', at('09:01')),
    ])
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await rows()).toHaveLength(2)
  })
})

/** Holds every racer at `db.batch` until all have arrived, then lets them commit (one by one: SQLite). */
function racing(count: number): Db {
  let arrived = 0
  let open!: () => void
  const all = new Promise<void>((resolve) => {
    open = resolve
  })
  const racer = Object.create(db) as Db
  racer.batch = (async (statements: Parameters<Db['batch']>[0]) => {
    if (++arrived === count) open()
    await all
    return db.batch(statements)
  }) as unknown as Db['batch']
  return racer
}

describe('the ping (9.0\'s staging check, D108)', () => {
  const usage = { inputTokens: { total: 12, noCache: 4, cacheRead: 8, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } }

  function hooks() {
    const pending: Promise<unknown>[] = []
    const errors: unknown[] = []
    return { pending, errors, hooks: { waitUntil: (p: Promise<unknown>) => void pending.push(p), onProviderError: (e: unknown) => void errors.push(e) } }
  }

  it('streams the answer and records the tokens once it ends', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Ready ' },
            { type: 'text-delta', id: 't', delta: 'to help.' },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      }),
    })
    const { pending, errors, hooks: h } = hooks()
    const result = await pingAssistant(db, sokha, settings, model, h, at('10:00'))
    expect(await result.text).toBe('Ready to help.')
    await Promise.all(pending)
    expect(errors).toEqual([])
    expect(await rows()).toMatchObject([{ userId: sokha.userId, feature: 'ping', outcome: 'ok', inputTokens: 12, outputTokens: 5, cachedInputTokens: 8 }])
  })

  it('a provider failure is logged and recorded as an error; it still counts', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('401 invalid x-api-key')
      },
    })
    const { pending, errors, hooks: h } = hooks()
    const result = await pingAssistant(db, sokha, settings, model, h, at('10:00'))
    await result.consumeStream()
    await Promise.all(pending)
    expect(errors).toHaveLength(1)
    expect(await rows()).toMatchObject([{ outcome: 'error', inputTokens: null, outputTokens: null }])
  })

  it('past the limit, the provider is never called', async () => {
    let calls = 0
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls++
        throw new Error('should not be called')
      },
    })
    await startUsage(db, sokha, settings, 'ping', at('09:00'))
    await startUsage(db, sokha, settings, 'ping', at('09:01'))
    await expectApiError(() => pingAssistant(db, sokha, settings, model, hooks().hooks, at('10:00')), 429, 'AI_LIMIT_REACHED')
    expect(calls).toBe(0)
  })
})

describe('cleanup (D108)', () => {
  it('removes usage older than 90 days and keeps the rest', async () => {
    const now = at('03:15')
    await startUsage(db, sokha, settings, 'ping', new Date(now.getTime() - 91 * 86_400_000))
    await startUsage(db, sokha, settings, 'ping', new Date(now.getTime() - 89 * 86_400_000))
    expect(await purgeAssistantUsage(db, now)).toBe(1)
    expect(await rows()).toHaveLength(1)
    expect(await purgeAssistantUsage(db, now)).toBe(0)
  })

  it('an account removed takes its usage with it', async () => {
    await startUsage(db, dara, settings, 'ping', at('09:00'))
    const { user } = await import('../../../db/tables')
    await db.delete(user).where(eq(user.id, dara.userId))
    expect(await rows()).toHaveLength(0)
  })
})
