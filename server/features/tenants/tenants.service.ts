import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { ChangeTenantSlugInput, CreatedTenant, CreateTenantInput, ResumeTenantInput, SuspendTenantInput, TenantDetail, TenantListQuery, TenantStatus, TenantSummary } from '#shared/contracts/tenants'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import { activeBranchCounts, firstBranchStatement } from '#server/features/branches'
import { planStaffCreate, staffCounts, tenantOwners } from '#server/features/identity'
import { orderActivity } from '#server/features/orders'
import { auditStatement } from '#server/features/platform'
import type { AuditActor } from '#server/features/platform'
import { alreadySuspended, notSuspended, ownerAccountChanged, sameSlug, slugTaken, tenantChanged, tenantNotFound } from './tenants.errors'
import * as repo from './tenants.repository'
import type { TenantRow } from './tenants.repository'

/**
 * The platform console (step T2a, D142): super admins create cafes (tenants, D134) with their
 * first branch and owner, pause and resume them, and change their web address. A super admin sees
 * a cafe's usage numbers, never its menu, orders or customers. Every change is versioned (409 when
 * stale) and audited in the cafe's own history, with the super admin as the actor.
 */

/** A super admin acting in the console (`requirePlatformPermission`). */
export interface PlatformActor {
  userId: string
  requestId?: string
}

const statusOf = (row: TenantRow): TenantStatus => row.status === 'suspended' ? 'suspended' : 'active'
const versionOf = (row: TenantRow) => row.version ?? 1

/** The audit trail of a change to a cafe: in that cafe's history, by the super admin. */
const audit = (db: Db, actor: PlatformActor, tenantId: string, action: string, metadata: Record<string, unknown> = {}) =>
  auditStatement(db, { userId: actor.userId, tenantId, requestId: actor.requestId } satisfies AuditActor, { action, targetType: 'tenant', targetId: tenantId, metadata })

async function toSummaries(db: Db, rows: TenantRow[], now = new Date()): Promise<TenantSummary[]> {
  const ids = rows.map(row => row.id)
  const [branches, staff, orders] = await Promise.all([activeBranchCounts(db, ids), staffCounts(db, ids), orderActivity(db, ids, now)])
  return rows.map((row) => {
    const activity = orders.get(row.id)
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: statusOf(row),
      suspendedReason: statusOf(row) === 'suspended' ? row.suspendedReason ?? null : null,
      createdAt: toIso(row.createdAt),
      version: versionOf(row),
      usage: {
        branches: branches.get(row.id) ?? 0,
        staff: staff.get(row.id) ?? 0,
        ordersLast30Days: activity?.recent ?? 0,
        lastOrderAt: activity?.lastPlacedAt ? toIso(activity.lastPlacedAt) : null,
      },
    }
  })
}

export async function listTenants(db: Db, query: TenantListQuery): Promise<Page<TenantSummary>> {
  const { rows, total } = await repo.listTenants(db, query)
  return {
    items: await toSummaries(db, rows),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: totalPages(total, query.pageSize),
  }
}

export async function getTenant(db: Db, id: string): Promise<TenantDetail> {
  const row = await repo.findTenant(db, id)
  if (!row) throw tenantNotFound()
  const [[summary], owners, formerSlugs] = await Promise.all([toSummaries(db, [row]), tenantOwners(db, id), repo.formerSlugs(db, id, row.slug)])
  return { ...summary!, owners, formerSlugs }
}

/**
 * A new cafe with its first branch and its first owner, in one batch: all of it or nothing. The
 * owner gets a temporary password shown once, or keeps their own when the email already has an
 * account (a customer, or someone working at another cafe).
 */
export async function createTenant(db: Db, actor: PlatformActor, input: CreateTenantInput, now = new Date()): Promise<CreatedTenant> {
  if (await repo.slugOwner(db, input.slug)) throw slugTaken()

  const tenantId = newId()
  const branch = firstBranchStatement(db, { tenantId, name: input.branchName, timezone: input.timezone, now })
  const owner = await planStaffCreate(db, { userId: actor.userId, tenantId, requestId: actor.requestId }, tenantId, {
    name: input.ownerName,
    email: input.ownerEmail,
    admin: true,
    memberships: [],
  }, now)
  const statements: Statement[] = [
    repo.insertTenantStatement(db, { id: tenantId, name: input.name, slug: input.slug, now }),
    repo.insertSlugStatement(db, { slug: input.slug, tenantId, now }),
    branch.statement,
    ...owner.statements,
    audit(db, actor, tenantId, 'tenant.create', { slug: input.slug, branchId: branch.id, ownerId: owner.userId, existingAccount: owner.temporaryPassword === null }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Another save took the address meanwhile, or the owner's account was created or changed.
    if (isUniqueViolation(error) && await repo.slugOwner(db, input.slug)) throw slugTaken()
    if (isUniqueViolation(error) || isStaleWrite(error)) throw ownerAccountChanged()
    throw error
  }
  return { tenant: await getTenant(db, tenantId), temporaryPassword: owner.temporaryPassword }
}

/** Runs a change guarded by the cafe's version; a stale write is someone else's change. */
async function runTenantChange(db: Db, statements: Statement[]) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isStaleWrite(error)) throw tenantChanged()
    throw error
  }
}

async function loadForChange(db: Db, id: string, version: number): Promise<TenantRow> {
  const row = await repo.findTenant(db, id)
  if (!row) throw tenantNotFound()
  if (versionOf(row) !== version) throw tenantChanged()
  return row
}

/**
 * Pauses a cafe: its customers see "Ordering is paused", its staff can't use the admin or the
 * counter (every cafe route answers 403 `TENANT_SUSPENDED`), nothing is deleted, and unpaid orders
 * still expire (D134).
 */
export async function suspendTenant(db: Db, actor: PlatformActor, id: string, input: SuspendTenantInput): Promise<TenantDetail> {
  const row = await loadForChange(db, id, input.version)
  if (statusOf(row) === 'suspended') throw alreadySuspended()
  await runTenantChange(db, [
    repo.updateTenantStatement(db, id, input.version, { status: 'suspended', suspendedReason: input.reason }),
    requireOneChange(db),
    audit(db, actor, id, 'tenant.suspend', { reason: input.reason }),
  ])
  return getTenant(db, id)
}

export async function resumeTenant(db: Db, actor: PlatformActor, id: string, input: ResumeTenantInput): Promise<TenantDetail> {
  const row = await loadForChange(db, id, input.version)
  if (statusOf(row) !== 'suspended') throw notSuspended()
  await runTenantChange(db, [
    repo.updateTenantStatement(db, id, input.version, { status: 'active', suspendedReason: null }),
    requireOneChange(db),
    audit(db, actor, id, 'tenant.resume'),
  ])
  return getTenant(db, id)
}

/**
 * Gives a cafe a new web address. The old one stays the cafe's and redirects to the new one
 * (printed menus, bookmarks, links already sent); no other cafe can take it. A cafe can take back
 * an address it had before. Printed table QR codes don't change: they don't name the cafe.
 */
export async function changeTenantSlug(db: Db, actor: PlatformActor, id: string, input: ChangeTenantSlugInput, now = new Date()): Promise<TenantDetail> {
  const row = await loadForChange(db, id, input.version)
  if (row.slug === input.slug) throw sameSlug()
  const owner = await repo.slugOwner(db, input.slug)
  if (owner && owner !== id) throw slugTaken()
  try {
    await runTenantChange(db, [
      repo.updateTenantStatement(db, id, input.version, { slug: input.slug }),
      requireOneChange(db),
      repo.forgetOwnSlugStatement(db, input.slug, id),
      repo.insertSlugStatement(db, { slug: input.slug, tenantId: id, now }),
      audit(db, actor, id, 'tenant.slug.change', { from: row.slug, to: input.slug }),
    ])
  }
  catch (error) {
    // Another cafe took the address meanwhile (the address history or the cafe's own index).
    if (isUniqueViolation(error)) throw slugTaken()
    throw error
  }
  return getTenant(db, id)
}

/**
 * For a page at an address a cafe no longer uses (D142): the cafe's current address, to redirect
 * to; `undefined` when no cafe ever had it.
 */
export async function currentSlugFor(db: Db, formerSlug: string): Promise<string | undefined> {
  const tenantId = await repo.slugOwner(db, formerSlug)
  if (!tenantId) return undefined
  const row = await repo.findTenant(db, tenantId)
  return row && row.slug !== formerSlug ? row.slug : undefined
}

/** The seed task's cafe (D134): the oldest one, or a new one when none exists yet. */
export async function seedTenant(db: Db, input: { name: string, slug: string }): Promise<{ id: string, name: string, slug: string, created: boolean }> {
  const existing = await repo.findOldestTenant(db)
  if (existing) return { id: existing.id, name: existing.name, slug: existing.slug, created: false }
  const tenant = { id: newId(), name: input.name, slug: input.slug, now: new Date() }
  await db.batch([repo.insertTenantStatement(db, tenant), repo.insertSlugStatement(db, { slug: tenant.slug, tenantId: tenant.id, now: tenant.now })])
  return { id: tenant.id, name: tenant.name, slug: tenant.slug, created: true }
}
