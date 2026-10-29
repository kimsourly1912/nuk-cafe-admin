/**
 * The watchdog (D224): once a minute, is production healthy? It tells the ops Telegram chat once
 * when production goes down (two failed checks in a row, so a blip says nothing) and once when it
 * recovers. It also says when a new version starts and sends a weekly "still watching" message,
 * so silence never hides a dead watchdog. A message that doesn't go through is sent again on the
 * next check: the state only moves on once the chat has been told.
 */

export interface WatchState {
  status: 'up' | 'down'
  /** Failed checks in a row. */
  failures: number
  /** When the first of those failures happened (ms since the epoch). */
  failingSince: number | null
  /** Failed checks since the last weekly message. */
  failedThisWeek: number
  /** Cambodia date (YYYY-MM-DD) of the last weekly message. */
  weeklySentOn: string | null
  /** The Worker version that last said it started. */
  version: string | null
}

export const INITIAL_STATE: WatchState = {
  status: 'up',
  failures: 0,
  failingSince: null,
  failedThisWeek: 0,
  weeklySentOn: null,
  version: null,
}

export interface WatchEnv {
  /** The page that answers `{"status":"ok"}` while production works. */
  HEALTH_URL: string
  /** Worker secrets: the ops bot's token and the Angder Ops group's chat id. */
  OPS_TELEGRAM_BOT_TOKEN?: string
  OPS_TELEGRAM_CHAT_ID?: string
  /** Telegram's API; only the local end-to-end check points it elsewhere. */
  TELEGRAM_API_URL?: string
}

export interface CheckOptions {
  state: WatchState
  env: WatchEnv
  /** This check's time (ms since the epoch). */
  now: number
  /** The running Worker version's id. */
  version: string
  fetch: typeof fetch
}

/** Failed checks in a row before DOWN: one failure is a blip. */
export const FAILURES_BEFORE_ALERT = 2
/** How long a health check or a Telegram message may take. */
const TIMEOUT_MS = 10_000
/** The health answer is a few bytes; anything longer is not an answer. */
const HEALTH_MAX_LENGTH = 4096
const RUNBOOK = 'What to do: docs/server/operations.md → When an alert arrives.'

/** Cambodia's clock (UTC+7, no daylight saving): the date, the weekday (1 = Monday) and the hour. */
export function cambodiaTime(ms: number) {
  const local = new Date(ms + 7 * 3_600_000)
  return {
    date: local.toISOString().slice(0, 10),
    label: `${local.toISOString().slice(0, 16).replace('T', ' ')} Cambodia time`,
    weekday: local.getUTCDay() === 0 ? 7 : local.getUTCDay(),
    hour: local.getUTCHours(),
  }
}

/** Why production is unhealthy, or `null` when `/api/health` answers 200 with `{"status":"ok"}`. */
export async function healthProblem(fetchFn: typeof fetch, url: string): Promise<string | null> {
  try {
    const response = await fetchFn(url, { headers: { 'user-agent': 'angder-watchdog' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.status !== 200) {
      await response.body?.cancel()
      return `it answered HTTP ${response.status}`
    }
    const text = await response.text()
    if (text.length > HEALTH_MAX_LENGTH) return 'its answer was not a health answer'
    return (JSON.parse(text) as { status?: unknown }).status === 'ok' ? null : 'it reported a problem'
  }
  catch (error) {
    return error instanceof Error && error.name === 'TimeoutError' ? 'it did not answer within 10 seconds' : 'it could not be reached'
  }
}

/** What one check did, logged as one line by the Worker. Never holds the token or the chat id. */
export interface CheckReport {
  /** Both Telegram secrets reached the Worker. */
  secrets: boolean
  /** `ok`, or why production is unhealthy; `null` when nothing was checked. */
  health: string | null
  healthMs: number | null
  /** Each message this check tried, and what Telegram did with it. */
  messages: { kind: string, result: string, ms: number }[]
  status: WatchState['status']
}

/**
 * Sends one message to the ops chat. `result` says what Telegram did: `sent`, `refused <status>:
 * <Telegram's reason>` (a wrong chat id or token, a bot removed from the group), or `no answer`.
 */
export async function sendToOpsChat(fetchFn: typeof fetch, env: WatchEnv, text: string): Promise<{ ok: boolean, result: string }> {
  try {
    const response = await fetchFn(`${env.TELEGRAM_API_URL ?? 'https://api.telegram.org'}/bot${env.OPS_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.OPS_TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.ok) {
      await response.body?.cancel()
      return { ok: true, result: 'sent' }
    }
    // Telegram's reason ("Bad Request: chat not found"); its answer never repeats the token.
    const answer = (await response.text().catch(() => '')).slice(0, 1000)
    let reason = 'no reason given'
    try {
      reason = String((JSON.parse(answer) as { description?: unknown }).description ?? reason).slice(0, 200)
    }
    catch {
      // Not JSON (a proxy's page): the status alone says enough.
    }
    return { ok: false, result: `refused ${response.status}: ${reason}` }
  }
  catch (error) {
    return { ok: false, result: `no answer (${error instanceof Error ? error.name : 'unknown'})` }
  }
}

/** One check: asks production, tells the chat what changed; returns the state to keep and a report. */
export async function runCheck(options: CheckOptions): Promise<{ state: WatchState, report: CheckReport }> {
  const { env, now, version, fetch: fetchFn } = options
  const report: CheckReport = { secrets: false, health: null, healthMs: null, messages: [], status: options.state.status }
  if (!env.OPS_TELEGRAM_BOT_TOKEN || !env.OPS_TELEGRAM_CHAT_ID) return { state: options.state, report }
  report.secrets = true
  const send = async (kind: string, text: string) => {
    const started = Date.now()
    const { ok, result } = await sendToOpsChat(fetchFn, env, text)
    report.messages.push({ kind, result, ms: Date.now() - started })
    return ok
  }
  const site = new URL(env.HEALTH_URL).host
  let state = { ...options.state }

  if (state.version !== version && await send('started', `Watchdog started: checking ${site} every minute. You'll get one message when it goes down, one when it recovers, and a weekly "still watching" on Mondays.`)) {
    state.version = version
  }

  const checkedAt = Date.now()
  const problem = await healthProblem(fetchFn, env.HEALTH_URL)
  report.health = problem ?? 'ok'
  report.healthMs = Date.now() - checkedAt
  if (problem === null) {
    const recovered = state.status === 'down'
    const minutes = state.failingSince === null ? 0 : Math.max(1, Math.round((now - state.failingSince) / 60_000))
    if (!recovered || await send('recovered', `RECOVERED: ${site} is healthy again at ${cambodiaTime(now).label}, after about ${minutes} minute${minutes === 1 ? '' : 's'}.`)) {
      state = { ...state, status: 'up', failures: 0, failingSince: null }
    }
  }
  else {
    state = { ...state, failures: state.failures + 1, failingSince: state.failingSince ?? now, failedThisWeek: state.failedThisWeek + 1 }
    if (state.status === 'up' && state.failures >= FAILURES_BEFORE_ALERT
      && await send('down', `DOWN: ${site} failed its health check ${state.failures} times in a row since ${cambodiaTime(state.failingSince!).label}: ${problem}. The site, its database or its background jobs are not working. ${RUNBOOK}`)) {
      state.status = 'down'
    }
  }

  // Mondays from 09:00 Cambodia time, once.
  const local = cambodiaTime(now)
  if (local.weekday === 1 && local.hour >= 9 && state.weeklySentOn !== local.date
    && await send('weekly', `Weekly check (${local.date}): the watchdog is running. ${site} is ${state.status === 'up' ? 'UP' : 'DOWN'}. Failed checks in the last week: ${state.failedThisWeek}.`)) {
    state = { ...state, weeklySentOn: local.date, failedThisWeek: 0 }
  }
  report.status = state.status
  return { state, report }
}
