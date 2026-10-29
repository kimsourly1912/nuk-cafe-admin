import { INITIAL_STATE, runCheck } from './watchdog'
import type { WatchEnv, WatchState } from './watchdog'

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

  /** One check. Runs are a minute apart and take at most about 40 s, so they never overlap. */
  async fetch(): Promise<Response> {
    const before = await this.state.storage.get<WatchState>('state') ?? INITIAL_STATE
    const after = await runCheck({ state: before, env: this.env, now: Date.now(), version: this.env.VERSION.id, fetch })
    await this.state.storage.put('state', after)
    return new Response(null, { status: 204 })
  }
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const watchdog = env.WATCHDOG.get(env.WATCHDOG.idFromName('production'))
    await watchdog.fetch('https://watchdog/check', { method: 'POST' })
  },
  fetch: (): Response => new Response('Not found', { status: 404 }),
}
