import { INITIAL_STATE, runCheck } from './watchdog'
import type { CheckReport, WatchEnv, WatchState } from './watchdog'

/**
 * The watchdog Worker (D224), deployed separately from the app as `angder-watchdog`: a Cron Trigger
 * every minute asks one Durable Object to run the check. The object keeps the up/down state in its
 * own storage: cron runs land in different Cloudflare locations, and a Durable Object reads its
 * latest state wherever that is (KV could hand an old state to the next run and repeat a message).
 * No public address (workers.dev and preview URLs are off); its own address answers 404.
 */

// The few runtime types used here, so the watchdog needs no Workers type package.
interface ObjectStorage {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
}
interface ObjectState {
  storage: ObjectStorage
}
interface ObjectNamespace {
  idFromName: (name: string) => unknown
  get: (id: unknown) => { fetch: (url: string, init?: RequestInit) => Promise<Response> }
}

interface Env extends WatchEnv {
  WATCHDOG: ObjectNamespace
  VERSION: { id: string }
}

export class Watchdog {
  private readonly state: ObjectState
  private readonly env: Env

  constructor(state: ObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  /** One check, answering its report. Runs are a minute apart and take at most about 40 s, so they never overlap. */
  async fetch(): Promise<Response> {
    const before = await this.state.storage.get<WatchState>('state') ?? INITIAL_STATE
    const { state, report } = await runCheck({ state: before, env: this.env, now: Date.now(), version: this.env.VERSION.id, fetch })
    await this.state.storage.put('state', state)
    return Response.json(report)
  }
}

export default {
  /** Logs one line per check (Workers & Pages → angder-watchdog → Observability): what it found and what Telegram did. */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const watchdog = env.WATCHDOG.get(env.WATCHDOG.idFromName('production'))
    const response = await watchdog.fetch('https://watchdog/check', { method: 'POST' })
    if (!response.ok) {
      console.error('Watchdog: the check failed', { status: response.status, error: (await response.text()).slice(0, 500) })
      return
    }
    const report = await response.json() as CheckReport
    const line = report.secrets ? 'Watchdog: checked' : 'Watchdog: OPS_TELEGRAM_BOT_TOKEN or OPS_TELEGRAM_CHAT_ID is not set; nothing checked'
    const failed = !report.secrets || report.messages.some(message => message.result !== 'sent')
    console[failed ? 'warn' : 'log'](line, report)
  },
  fetch: (): Response => new Response('Not found', { status: 404 }),
}
