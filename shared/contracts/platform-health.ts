import type { CafeRef } from './tenants'

/**
 * The platform console's System health (`GET /api/platform/health`, step P4, D192): read-only
 * counts and dates about the platform's machinery. Never a secret, a message's content, a chat, an
 * address or an error's text: a token's expiry date, not the token.
 */

export interface OutboxHealthGroup {
  /** `orders.event`, `identity.reset-password`… */
  kind: string
  /** `null`: the platform's own (account emails). */
  cafe: CafeRef | null
  /** Not tried yet. */
  waiting: number
  /** Failed a try, will be retried. */
  failing: number
  /** Given up on after the last try. */
  dead: number
  /** When the oldest unsent message of the group was made. */
  oldestAt: string | null
}

export interface OutboxHealth {
  waiting: number
  failing: number
  dead: number
  groups: OutboxHealthGroup[]
}

export type JobState = 'ok' | 'failing' | 'never'

export interface JobHealth {
  job: string
  /** Cron, in UTC. */
  schedule: string
  state: JobState
  /** Within 5 minutes while it keeps succeeding (D192). */
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  failuresInARow: number
}

export interface TelegramHealth {
  cafe: CafeRef
  /** Given up on, among the deliveries of the last 7 days. */
  failed: number
  /** Failed a try, will be retried. */
  retrying: number
  /** When the newest failing delivery was made. */
  newestFailingAt: string | null
}

export type BakongTokenState = 'expired' | 'soon' | 'ok' | 'unknown'

export interface BakongTokenHealth {
  cafe: CafeRef
  /** The token's expiry date, never the token; `null` when the token carries none. */
  expiresAt: string | null
  /** `soon`: within `BAKONG_TOKEN_WARNING_DAYS`; `unknown`: no expiry in the token. */
  state: BakongTokenState
}

export interface PlatformHealth {
  checkedAt: string
  outbox: OutboxHealth
  jobs: JobHealth[]
  /** Cafes with failing Telegram deliveries in the last `TELEGRAM_HEALTH_DAYS` days, most failed first. */
  telegram: TelegramHealth[]
  /** Every cafe with a saved Bakong token, soonest expiry first. */
  bakong: BakongTokenHealth[]
}

export const TELEGRAM_HEALTH_DAYS = 7
