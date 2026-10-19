import type { ActivityDetails, ActivityEntry, ActivityPerson, ActivityQuery, PlatformAction, PlatformOverview } from '#shared/contracts/platform-activity'
import { PLATFORM_ACTIONS } from '#shared/contracts/platform-activity'
import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { Db } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import { addDays, localDate, zonedInstant } from '#server/utils/weekly-windows'
import { accountIdentities, countBannedAccounts } from '#server/features/identity'
import { tenantsOrderingRecently } from '#server/features/orders'
import { listAuditEvents } from '#server/features/platform'
import type { AuditRow } from '#server/features/platform'
import * as repo from './tenants.repository'
import { countTenants } from './tenants.service'

/**
 * The platform console's Overview and Activity (step P3, D191). The Overview counts cafes and
 * accounts, never a cafe's contents (D186). Activity lists what the platform team did: only the
 * actions the console writes (`PLATFORM_ACTIONS`), so a cafe's own staff's audit rows never show,
 * even an owner's `tenant.profile.update`.
 */

/** A cafe without an order this long is "quiet" on the Overview. */
export const QUIET_DAYS = 7

/** The Overview's counts. The month starts on the 1st at midnight in the platform's time zone. */
export async function getPlatformOverview(db: Db, timeZone: string, now = new Date()): Promise<PlatformOverview> {
  const monthStart = zonedInstant(`${localDate(now, timeZone).slice(0, 7)}-01`, 0, timeZone)
  const [cafes, counts, active, bannedAccounts] = await Promise.all([
    countTenants(db),
    repo.overviewCounts(db, monthStart),
    repo.activeTenantIds(db),
    countBannedAccounts(db),
  ])
  const ordering = await tenantsOrderingRecently(db, active, QUIET_DAYS, now)
  return {
    cafes,
    newCafesThisMonth: counts.created,
    quietCafes: active.filter(id => !ordering.has(id)).length,
    noActiveOwner: counts.ownerless,
    bannedAccounts,
    timeZone,
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** Only the metadata keys the console shows: nothing else of the row leaves the server. */
function detailsOf(metadata: Record<string, unknown>): ActivityDetails {
  const details: ActivityDetails = {}
  if ('reason' in metadata) details.reason = text(metadata.reason) ?? null
  if (text(metadata.from)) details.from = text(metadata.from)
  if (text(metadata.to)) details.to = text(metadata.to)
  if ('until' in metadata) details.until = text(metadata.until) ?? null
  if (Array.isArray(metadata.fields)) details.fields = metadata.fields.filter((field): field is string => typeof field === 'string')
  if (typeof metadata.newAccount === 'boolean') details.newAccount = metadata.newAccount
  if (typeof metadata.staysStaff === 'boolean') details.staysStaff = metadata.staysStaff
  return details
}

/** The account an entry acted on: a ban's account, the owner added or removed, a transfer's new owner. */
function accountIdOf(row: AuditRow): string | undefined {
  const metadata = row.metadata ?? {}
  if (row.targetType === 'user') return row.targetId ?? undefined
  if (row.action === 'tenant.owner.transfer') return text(metadata.toId)
  return text(metadata.ownerId)
}

/** The platform team's actions, newest first, filtered by who, which cafe, what and when. */
export async function listPlatformActivity(db: Db, query: ActivityQuery, timeZone: string): Promise<Page<ActivityEntry>> {
  const { rows, total } = await listAuditEvents(db, {
    actions: query.action ? [query.action] : PLATFORM_ACTIONS,
    actorId: query.actorId,
    tenantId: query.tenantId,
    since: query.from ? zonedInstant(query.from, 0, timeZone) : undefined,
    before: query.to ? zonedInstant(addDays(query.to, 1), 0, timeZone) : undefined,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  })
  const people = await accountIdentities(db, rows.flatMap(row => [row.actorId, accountIdOf(row), text(row.metadata?.fromId)]).filter((id): id is string => !!id))
  const cafes = new Map((await repo.tenantRefs(db, [...new Set(rows.flatMap(row => row.tenantId ?? []))])).map(cafe => [cafe.id, cafe]))
  const person = (id: string | null | undefined): ActivityPerson | null => {
    if (!id) return null
    const found = people.get(id)
    return { id, name: found?.name ?? null, email: found?.email ?? null }
  }
  return {
    items: rows.map(row => ({
      id: row.id,
      at: toIso(row.at),
      action: row.action as PlatformAction,
      actor: person(row.actorId),
      cafe: row.tenantId ? cafes.get(row.tenantId) ?? { id: row.tenantId, name: 'Unknown cafe', slug: '' } : null,
      account: person(accountIdOf(row)),
      previousOwner: row.action === 'tenant.owner.transfer' ? person(text(row.metadata?.fromId)) : null,
      details: detailsOf(row.metadata ?? {}),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: totalPages(total, query.pageSize),
  }
}
