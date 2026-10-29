import { afterEach, describe, expect, it, vi } from 'vitest'
import { cambodiaTime, FAILURES_BEFORE_ALERT, healthProblem, INITIAL_STATE, runCheck } from '../src/watchdog'
import type { WatchState } from '../src/watchdog'

// The watchdog's decisions (D224) with stand-ins for production's health page and Telegram.

const env = { HEALTH_URL: 'https://angder.app/api/health', OPS_TELEGRAM_BOT_TOKEN: '123:secret-token', OPS_TELEGRAM_CHAT_ID: '-100' }
/** Wednesday 2026-10-28 21:00 Cambodia time (no weekly message due). */
const WEDNESDAY = Date.parse('2026-10-28T14:00:00Z')
const minutes = (n: number) => WEDNESDAY + n * 60_000
const RUNNING = { ...INITIAL_STATE, version: 'v1' }

type Health = 'ok' | 'error' | 'down-json' | 'timeout' | 'unreachable'

/** Production answering `health`, Telegram answering `telegram`; records what was sent. */
function world(health: Health, telegram: 'ok' | 'refuses' | 'unreachable' = 'ok') {
  const sent: string[] = []
  const urls: string[] = []
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('api.telegram.org')) {
      if (telegram === 'unreachable') throw new TypeError('fetch failed')
      sent.push((JSON.parse(String(init!.body)) as { text: string }).text)
      return new Response('{"ok":true}', { status: telegram === 'ok' ? 200 : 401 })
    }
    if (health === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    if (health === 'unreachable') throw new TypeError('fetch failed')
    if (health === 'error') return new Response('<html>Error 1101</html>', { status: 500 })
    return Response.json({ status: health === 'ok' ? 'ok' : 'unavailable' })
  }) as unknown as typeof fetch
  return { fetchFn, sent, urls }
}

async function check(state: WatchState, now: number, health: Health, telegram?: 'ok' | 'refuses' | 'unreachable') {
  const w = world(health, telegram)
  const next = await runCheck({ state, env, now, version: 'v1', fetch: w.fetchFn })
  return { state: next, sent: w.sent, urls: w.urls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('down and recovered (D224)', () => {
  it('one failed check is a blip: no message, and the next good check forgets it', async () => {
    const blip = await check(RUNNING, minutes(0), 'error')
    expect(blip.sent).toEqual([])
    expect(blip.state).toMatchObject({ status: 'up', failures: 1, failingSince: minutes(0) })
    const back = await check(blip.state, minutes(1), 'ok')
    expect(back.sent).toEqual([])
    expect(back.state).toMatchObject({ status: 'up', failures: 0, failingSince: null })
  })

  it(`DOWN once after ${FAILURES_BEFORE_ALERT} failures in a row, nothing while it stays down, RECOVERED once`, async () => {
    const first = await check(RUNNING, minutes(0), 'error')
    const second = await check(first.state, minutes(1), 'error')
    expect(second.sent).toHaveLength(1)
    expect(second.sent[0]).toMatch(/^DOWN: angder\.app failed its health check 2 times in a row since 2026-10-28 21:00 Cambodia time: it answered HTTP 500\./)
    expect(second.sent[0]).toContain('docs/server/operations.md')
    expect(second.state).toMatchObject({ status: 'down', failures: 2 })

    const still = await check(second.state, minutes(2), 'error')
    expect(still.sent).toEqual([])
    const recovered = await check(still.state, minutes(15), 'ok')
    expect(recovered.sent).toEqual(['RECOVERED: angder.app is healthy again at 2026-10-28 21:15 Cambodia time, after about 15 minutes.'])
    expect(recovered.state).toMatchObject({ status: 'up', failures: 0, failingSince: null, failedThisWeek: 3 })
  })

  it('says "1 minute", not "1 minutes"', async () => {
    const down = { ...RUNNING, status: 'down' as const, failures: 2, failingSince: minutes(0) }
    expect((await check(down, minutes(1), 'ok')).sent).toEqual([expect.stringMatching(/after about 1 minute\.$/)])
  })

  it('names the problem: unhealthy JSON, a timeout, no answer at all', async () => {
    expect(await healthProblem(world('down-json').fetchFn, env.HEALTH_URL)).toBe('it reported a problem')
    expect(await healthProblem(world('timeout').fetchFn, env.HEALTH_URL)).toBe('it did not answer within 10 seconds')
    expect(await healthProblem(world('unreachable').fetchFn, env.HEALTH_URL)).toBe('it could not be reached')
    expect(await healthProblem(world('ok').fetchFn, env.HEALTH_URL)).toBeNull()
  })

  it('a long answer is not a health answer, and the check never follows a redirect', async () => {
    const long = vi.fn(async () => new Response('x'.repeat(5000))) as unknown as typeof fetch
    expect(await healthProblem(long, env.HEALTH_URL)).toBe('its answer was not a health answer')
    const moved = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('manual')
      return new Response(null, { status: 301, headers: { location: 'https://elsewhere.example' } })
    }) as unknown as typeof fetch
    expect(await healthProblem(moved, env.HEALTH_URL)).toBe('it answered HTTP 301')
  })

  it('a message Telegram doesn\'t take is sent again on the next check, not lost', async () => {
    const first = await check(RUNNING, minutes(0), 'error')
    const refused = await check(first.state, minutes(1), 'error', 'refuses')
    expect(refused.state.status).toBe('up')
    const unreachable = await check(refused.state, minutes(2), 'error', 'unreachable')
    expect(unreachable.state.status).toBe('up')
    const delivered = await check(unreachable.state, minutes(3), 'error')
    expect(delivered.sent).toHaveLength(1)
    expect(delivered.sent[0]).toMatch(/^DOWN: .* 4 times in a row since 2026-10-28 21:00/)
    expect(delivered.state.status).toBe('down')

    const notTold = await check(delivered.state, minutes(4), 'ok', 'refuses')
    expect(notTold.state.status).toBe('down')
    const told = await check(notTold.state, minutes(5), 'ok')
    expect(told.sent).toEqual([expect.stringMatching(/^RECOVERED: .* after about 5 minutes\./)])
    expect(told.state.status).toBe('up')
  })
})

describe('started, weekly and secrets (D224)', () => {
  it('says it started once per version, and again after a new deploy', async () => {
    const fresh = await check(INITIAL_STATE, minutes(0), 'ok')
    expect(fresh.sent).toEqual([expect.stringMatching(/^Watchdog started: checking angder\.app every minute\./)])
    expect(fresh.state.version).toBe('v1')
    expect((await check(fresh.state, minutes(1), 'ok')).sent).toEqual([])
    const w = world('ok')
    const redeployed = await runCheck({ state: fresh.state, env, now: minutes(2), version: 'v2', fetch: w.fetchFn })
    expect(w.sent).toHaveLength(1)
    expect(redeployed.version).toBe('v2')
    // Not told: asks again next time.
    expect((await check(INITIAL_STATE, minutes(0), 'ok', 'refuses')).state.version).toBeNull()
  })

  it('a weekly "still watching" on Mondays from 09:00 Cambodia time, once, with the week\'s failed checks', async () => {
    const monday = (hhmm: string) => Date.parse(`2026-11-02T${hhmm}:00+07:00`)
    const week = { ...RUNNING, failedThisWeek: 3 }
    expect((await check(week, monday('08:59'), 'ok')).sent).toEqual([])
    const sent = await check(week, monday('09:00'), 'ok')
    expect(sent.sent).toEqual(['Weekly check (2026-11-02): the watchdog is running. angder.app is UP. Failed checks in the last week: 3.'])
    expect(sent.state).toMatchObject({ weeklySentOn: '2026-11-02', failedThisWeek: 0 })
    expect((await check(sent.state, monday('09:01'), 'ok')).sent).toEqual([])
    // Sunday 23:59 in Cambodia is still Sunday, although it's Monday in some other places.
    expect(cambodiaTime(Date.parse('2026-11-01T23:59:00+07:00')).weekday).toBe(7)
  })

  it('without the secrets it checks nothing and sends nothing, and keeps its state', async () => {
    const w = world('error')
    const state = await runCheck({ state: RUNNING, env: { HEALTH_URL: env.HEALTH_URL }, now: minutes(0), version: 'v1', fetch: w.fetchFn })
    expect(state).toEqual(RUNNING)
    expect(w.urls).toEqual([])
  })

  it('never writes the bot token to the logs', async () => {
    const logs: unknown[] = []
    for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args))
    await check(RUNNING, minutes(0), 'error', 'refuses')
    await check({ ...RUNNING, failures: 1, failingSince: minutes(0) }, minutes(1), 'error', 'unreachable')
    expect(logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(logs)).not.toContain('secret-token')
  })
})
