import type { BakongTokenState, JobHealth, PlatformHealth } from '#shared/contracts/platform-health'
import { TELEGRAM_HEALTH_DAYS } from '#shared/contracts/platform-health'
import { BAKONG_TOKEN_WARNING_DAYS } from '#shared/contracts/orders'
import { SCHEDULED_JOBS } from '#shared/scheduled-tasks'
import type { CafeRef } from '#shared/contracts/tenants'
import type { Db } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import { telegramDeliveryHealth } from '#server/features/notifications'
import { bakongTokenExpiries } from '#server/features/orders'
import { jobRunRows, outboxHealth } from '#server/features/platform'
import * as repo from './tenants.repository'

/**
 * The platform console's System health (step P4, D192): read-only counts and dates from the
 * outbox, the scheduled jobs, Telegram deliveries and the Bakong tokens' expiry, each cafe named
 * and linked. Never a secret or a message: each feature answers counts and dates, and only these
 * fields are put together here.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const iso = (date: Date | null | undefined) => (date ? toIso(date) : null)

function bakongState(expiresAt: Date | null, now: Date): BakongTokenState {
  if (!expiresAt) return 'unknown'
  if (expiresAt.getTime() <= now.getTime()) return 'expired'
  return expiresAt.getTime() - now.getTime() <= BAKONG_TOKEN_WARNING_DAYS * DAY_MS ? 'soon' : 'ok'
}

export async function getPlatformHealth(db: Db, now = new Date()): Promise<PlatformHealth> {
  const [outbox, runs, telegram, tokens] = await Promise.all([
    outboxHealth(db),
    jobRunRows(db),
    telegramDeliveryHealth(db, new Date(now.getTime() - TELEGRAM_HEALTH_DAYS * DAY_MS)),
    bakongTokenExpiries(db),
  ])
  const ids = [...new Set([...outbox.flatMap(row => row.tenantId ?? []), ...telegram.map(row => row.tenantId), ...tokens.map(row => row.tenantId)])]
  const refs = new Map((await repo.findTenantRefs(db, ids)).map(cafe => [cafe.id, cafe]))
  const cafe = (id: string): CafeRef => refs.get(id) ?? { id, name: 'Unknown cafe', slug: '' }

  const byJob = new Map(runs.map(run => [run.job, run]))
  const jobs: JobHealth[] = SCHEDULED_JOBS.map(({ job, schedule }) => {
    const run = byJob.get(job)
    return {
      job,
      schedule,
      state: !run ? 'never' : run.failuresInARow > 0 ? 'failing' : 'ok',
      lastRunAt: iso(run?.lastRunAt),
      lastSuccessAt: iso(run?.lastSuccessAt),
      lastFailureAt: iso(run?.lastFailureAt),
      failuresInARow: run?.failuresInARow ?? 0,
    }
  })

  const groups = outbox
    .map(row => ({ kind: row.kind, cafe: row.tenantId ? cafe(row.tenantId) : null, waiting: row.waiting, failing: row.failing, dead: row.dead, oldestAt: iso(row.oldestAt) }))
    .sort((a, b) => (b.dead - a.dead) || (b.failing - a.failing) || (b.waiting - a.waiting) || a.kind.localeCompare(b.kind))
  return {
    checkedAt: toIso(now),
    outbox: {
      waiting: groups.reduce((sum, group) => sum + group.waiting, 0),
      failing: groups.reduce((sum, group) => sum + group.failing, 0),
      dead: groups.reduce((sum, group) => sum + group.dead, 0),
      groups,
    },
    jobs,
    telegram: telegram
      .map(row => ({ cafe: cafe(row.tenantId), failed: row.failed, retrying: row.retrying, newestFailingAt: iso(row.lastFailureAt) }))
      .sort((a, b) => (b.failed - a.failed) || (b.retrying - a.retrying) || a.cafe.name.localeCompare(b.cafe.name)),
    bakong: tokens
      .map(row => ({ cafe: cafe(row.tenantId), expiresAt: iso(row.expiresAt), state: bakongState(row.expiresAt, now) }))
      .sort((a, b) => (a.expiresAt ?? '9').localeCompare(b.expiresAt ?? '9') || a.cafe.name.localeCompare(b.cafe.name)),
  }
}
