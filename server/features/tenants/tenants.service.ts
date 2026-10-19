import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { AccountCafe, CafeProfile, CafeSettings, UpdateCafeInput } from '#shared/contracts/cafe'
import type { AddOwnerInput, ChangeTenantSlugInput, CreatedTenant, CreateTenantInput, NewCafeOwner, OwnerChange, OwnerSearchQuery, PlatformOwner, RemoveOwnerInput, ResumeTenantInput, SlugAvailability, SuspendTenantInput, TenantCounts, TenantDetail, TenantListQuery, TenantNotes, TenantStatus, TenantSummary, TransferOwnerInput, UpdateTenantNotesInput } from '#shared/contracts/tenants'
import { TENANT_STATUSES } from '#shared/contracts/tenants'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { notFound } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import { activeBranchCounts, firstBranchStatement } from '#server/features/branches'
import { accountForEmail, accountWorkspaces, activeOwnerCounts, ownerCandidates, ownershipFacts, planExistingOwner, planNewOwner, planOwnerRemoval, planStaffCreate, requireAnOwner, requireEligibleAccount, staffCounts, tenantOwners } from '#server/features/identity'
import type { Actor, OwnerAccount, OwnerAddPlan, SessionUser } from '#server/features/identity'
import { assetUrls, attachStatements, mediaNotAvailable, releaseStatement } from '#server/features/media'
import { orderActivity } from '#server/features/orders'
import { auditStatement } from '#server/features/platform'
import type { AuditActor } from '#server/features/platform'
import { accountExists, accountNotEligible, alreadyOwner, alreadySuspended, emailUnavailable, lastOwner, notesChanged, notSuspended, ownerAccountChanged, ownerNotFound, ownershipChanged, ownOwnership, sameSlug, slugTaken, tenantChanged, tenantNotFound } from './tenants.errors'
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
  const [branches, staff, orders, owners] = await Promise.all([activeBranchCounts(db, ids), staffCounts(db, ids), orderActivity(db, ids, now), activeOwnerCounts(db, ids)])
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
      activeOwners: owners.get(row.id) ?? 0,
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

/** The list's status tabs in one read: every status, zeros included. */
export async function countTenants(db: Db): Promise<TenantCounts> {
  const counts = Object.fromEntries(TENANT_STATUSES.map(status => [status, 0])) as TenantCounts
  for (const row of await repo.countTenants(db)) counts[row.status] = row.total
  return counts
}

export async function getTenant(db: Db, id: string): Promise<TenantDetail> {
  const row = await repo.findTenant(db, id)
  if (!row) throw tenantNotFound()
  const [[summary], owners, formerSlugs, notes] = await Promise.all([toSummaries(db, [row]), tenantOwners(db, id), repo.formerSlugs(db, id, row.slug), repo.findNotes(db, id)])
  return { ...summary!, owners, formerSlugs, notes: notesOf(notes) }
}

function notesOf(row: repo.TenantNotesRow | undefined): TenantNotes {
  return {
    contactName: row?.contactName ?? null,
    contactPhone: row?.contactPhone ?? null,
    notes: row?.notes ?? null,
    version: row?.version ?? 0,
    updatedAt: row ? toIso(row.updatedAt) : null,
  }
}

/** Accounts with the cafes they own, by name (D146). */
async function withCafes(db: Db, owners: OwnerAccount[]): Promise<PlatformOwner[]> {
  if (!owners.length) return []
  const refs = await repo.tenantRefs(db, [...new Set(owners.flatMap(owner => owner.tenantIds))])
  return owners.map(({ tenantIds, ...owner }) => ({ ...owner, cafes: refs.filter(ref => tenantIds.includes(ref.id)) }))
}

/** A bounded search of the accounts a cafe can be given to, by name or email (`GET /api/platform/owner-candidates`, D185). */
export async function searchOwnerAccounts(db: Db, query: OwnerSearchQuery): Promise<PlatformOwner[]> {
  return withCafes(db, await ownerCandidates(db, { search: query.search }))
}

/** One such account by id, for a page that opens with it chosen; 404 when it can't be chosen. */
export async function getOwnerAccount(db: Db, userId: string): Promise<PlatformOwner> {
  const [account] = await withCafes(db, await ownerCandidates(db, { userId }))
  if (!account) throw notFound('The account')
  return account
}

/**
 * Whether no cafe has or had this address (`GET /api/platform/slug-availability`, D185): the
 * address history keeps every address a cafe ever had. Advisory: another save may take it before
 * this one, and creating the cafe decides.
 */
export async function checkSlug(db: Db, slug: string): Promise<SlugAvailability> {
  return { slug, available: !await repo.slugOwner(db, slug) }
}

/**
 * The first owner's account: an existing account by id (registered and not disabled; its name and
 * email are the account's own), or a new person by name and email. A new person's email must have
 * no account: one that exists is chosen as an existing account instead, so "Create new account"
 * never quietly hands out access on someone's own password (D185).
 */
async function resolveOwner(db: Db, owner: CreateTenantInput['owner']): Promise<{ name: string, email: string, userId?: string }> {
  if (owner.kind === 'existing') {
    const [account] = await ownerCandidates(db, { userId: owner.userId })
    if (!account) throw accountNotEligible()
    return { name: account.name, email: account.email, userId: account.id }
  }
  const known = await accountForEmail(db, owner.email)
  if (known) throw known.eligible ? accountExists() : emailUnavailable()
  return { name: owner.name, email: owner.email }
}

/**
 * A new cafe with its first branch and its first owner, in one batch: all of it or nothing. A new
 * owner gets a temporary password shown once; an existing account keeps its own. The answer names
 * every cafe the owner has now, the new one included.
 */
export async function createTenant(db: Db, actor: PlatformActor, input: CreateTenantInput, now = new Date()): Promise<CreatedTenant> {
  if (await repo.slugOwner(db, input.slug)) throw slugTaken()
  const ownerInput = await resolveOwner(db, input.owner)

  const tenantId = newId()
  const branch = firstBranchStatement(db, { tenantId, name: input.branchName, timezone: input.timezone, now })
  const owner = await planStaffCreate(db, { userId: actor.userId, tenantId, requestId: actor.requestId }, tenantId, {
    name: ownerInput.name,
    email: ownerInput.email,
    admin: true,
    memberships: [],
  }, now)
  // A new person's email got an account between the check and the plan.
  if (input.owner.kind === 'new' && owner.temporaryPassword === null) throw accountExists()
  // The chosen owner's email now belongs to another account: they changed it meanwhile.
  if (ownerInput.userId && owner.userId !== ownerInput.userId) throw ownerAccountChanged()
  const statements: Statement[] = [
    repo.insertTenantStatement(db, { id: tenantId, name: input.name, slug: input.slug, now }),
    repo.insertSlugStatement(db, { slug: input.slug, tenantId, now }),
    branch.statement,
    // An account that was disabled, or became a guest, since it was read aborts everything.
    ...(ownerInput.userId ? [requireEligibleAccount(db, ownerInput.userId)] : []),
    ...owner.statements,
    audit(db, actor, tenantId, 'tenant.create', { slug: input.slug, branchId: branch.id, ownerId: owner.userId, ownerKind: input.owner.kind, existingAccount: owner.temporaryPassword === null }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Another save took the address meanwhile, or the owner's account was created or changed.
    if (isUniqueViolation(error) && await repo.slugOwner(db, input.slug)) throw slugTaken()
    if (isUniqueViolation(error) && input.owner.kind === 'new' && await accountForEmail(db, input.owner.email)) throw accountExists()
    if (isUniqueViolation(error)) throw ownerAccountChanged()
    if (isStaleWrite(error)) {
      // The chosen account's version moved, or it can't own a cafe any more.
      if (ownerInput.userId && !(await ownerCandidates(db, { userId: ownerInput.userId })).length) throw accountNotEligible()
      throw ownerAccountChanged()
    }
    throw error
  }
  const [tenant, ownerCafes] = await Promise.all([getTenant(db, tenantId), ownerCandidates(db, { userId: owner.userId }).then(accounts => withCafes(db, accounts))])
  // The answer names the cafe it was given even when the account is no longer eligible.
  const fallback = { id: owner.userId, name: ownerInput.name, email: ownerInput.email, cafes: [{ id: tenant.id, name: tenant.name, slug: tenant.slug }] }
  return { tenant, temporaryPassword: owner.temporaryPassword, owner: ownerCafes[0] ?? fallback }
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

// --- Ownership (step P2, D189) ---

/*
 * A super admin adds, removes or transfers a cafe's ownership alone, with a reason kept in the
 * audit row (D186). Each change is one batch: the cafe's version (409 when stale), each account's
 * version and eligibility, the last-owner guard (`requireAnOwner`: at least one owner who can sign
 * in) and the audit row in the cafe's history. Never one's own ownership: that is one's own role,
 * changed by another super admin (the plan's self-protection). A super admin may be a cafe's owner
 * (QT4, answered 2026-10-19).
 */

/** Whether an owner other than `userId` can sign in. */
async function othersCanSignIn(db: Db, tenantId: string, userId: string): Promise<boolean> {
  return (await tenantOwners(db, tenantId)).some(owner => owner.id !== userId && !owner.banned)
}

/** The account to make an owner: an existing one that can own a cafe and doesn't own this one yet, or a new person. */
async function planAddition(db: Db, actor: PlatformActor, tenantId: string, owner: NewCafeOwner, now: Date): Promise<OwnerAddPlan> {
  if (owner.kind === 'new') {
    const known = await accountForEmail(db, owner.email)
    if (known) throw known.eligible ? accountExists() : emailUnavailable()
    return planNewOwner(db, tenantId, owner, now)
  }
  if (owner.userId === actor.userId) throw ownOwnership()
  const facts = (await ownerCandidates(db, { userId: owner.userId })).length ? await ownershipFacts(db, tenantId, owner.userId) : undefined
  if (!facts) throw accountNotEligible()
  if (facts.role === 'owner') throw alreadyOwner()
  return planExistingOwner(db, tenantId, facts, now)
}

/**
 * Runs an ownership batch and names what stopped it: someone changed the cafe, an account made with
 * the new owner's email meanwhile, the chosen account can't own a cafe any more, the last owner who
 * can sign in would go (`removing`), or an account's version moved.
 */
async function runOwnershipBatch(db: Db, tenantId: string, version: number, statements: Statement[], change: { owner?: NewCafeOwner, removing?: string }) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isUniqueViolation(error) && change.owner?.kind === 'new') throw accountExists()
    if (!isStaleWrite(error)) throw error
    const current = await repo.findTenant(db, tenantId)
    if (!current || versionOf(current) !== version) throw tenantChanged()
    if (change.owner?.kind === 'existing' && !(await ownerCandidates(db, { userId: change.owner.userId })).length) throw accountNotEligible()
    if (change.removing && !change.owner && !await othersCanSignIn(db, tenantId, change.removing)) throw lastOwner()
    throw ownershipChanged()
  }
}

/** The cafe's version moves with every ownership change: two super admins can't both act on what they saw. */
const ownershipVersion = (db: Db, tenantId: string, version: number) => [repo.updateTenantStatement(db, tenantId, version, {}), requireOneChange(db)]

/**
 * Adds an owner: an existing account (it keeps its password, its branch roles and its other cafes)
 * or a new account with a temporary password, returned once. For a cafe whose owners are all banned
 * or unreachable (the plan's "No active owner").
 */
export async function addOwner(db: Db, actor: PlatformActor, tenantId: string, input: AddOwnerInput, now = new Date()): Promise<OwnerChange> {
  await loadForChange(db, tenantId, input.version)
  const plan = await planAddition(db, actor, tenantId, input.owner, now)
  await runOwnershipBatch(db, tenantId, input.version, [
    ...ownershipVersion(db, tenantId, input.version),
    ...plan.statements,
    audit(db, actor, tenantId, 'tenant.owner.add', { ownerId: plan.userId, newAccount: plan.temporaryPassword !== null, reason: input.reason }),
  ], { owner: input.owner })
  return { tenant: await getTenant(db, tenantId), temporaryPassword: plan.temporaryPassword }
}

/** An owner of this cafe other than the caller; another cafe's owner is 404 here. */
async function loadOwner(db: Db, actor: PlatformActor, tenantId: string, userId: string) {
  if (userId === actor.userId) throw ownOwnership()
  const facts = await ownershipFacts(db, tenantId, userId)
  if (facts?.role !== 'owner') throw ownerNotFound()
  return facts
}

/**
 * Removes an owner: they keep staff access only if they work at one of the cafe's branches, and
 * every session of theirs ends. Refused when no other owner could sign in (409 `LAST_OWNER`):
 * transfer the ownership instead.
 */
export async function removeOwner(db: Db, actor: PlatformActor, tenantId: string, userId: string, input: RemoveOwnerInput, now = new Date()): Promise<OwnerChange> {
  await loadForChange(db, tenantId, input.version)
  const facts = await loadOwner(db, actor, tenantId, userId)
  if (!await othersCanSignIn(db, tenantId, userId)) throw lastOwner()
  const removal = await planOwnerRemoval(db, tenantId, facts, now)
  await runOwnershipBatch(db, tenantId, input.version, [
    ...ownershipVersion(db, tenantId, input.version),
    ...removal.statements,
    requireAnOwner(db, tenantId),
    audit(db, actor, tenantId, 'tenant.owner.remove', { ownerId: userId, staysStaff: removal.staysStaff, reason: input.reason }),
  ], { removing: userId })
  return { tenant: await getTenant(db, tenantId), temporaryPassword: null }
}

/**
 * Transfers an owner's ownership: the new owner is added and this one removed in one batch, so the
 * cafe is never without both. Works when the old owner is banned (the usual case: "owner
 * unreachable"). The old owner keeps staff access only if they work at a branch.
 */
export async function transferOwner(db: Db, actor: PlatformActor, tenantId: string, fromUserId: string, input: TransferOwnerInput, now = new Date()): Promise<OwnerChange> {
  await loadForChange(db, tenantId, input.version)
  const from = await loadOwner(db, actor, tenantId, fromUserId)
  const plan = await planAddition(db, actor, tenantId, input.owner, now)
  const removal = await planOwnerRemoval(db, tenantId, from, now)
  await runOwnershipBatch(db, tenantId, input.version, [
    ...ownershipVersion(db, tenantId, input.version),
    ...plan.statements,
    ...removal.statements,
    requireAnOwner(db, tenantId),
    audit(db, actor, tenantId, 'tenant.owner.transfer', { fromId: fromUserId, toId: plan.userId, newAccount: plan.temporaryPassword !== null, staysStaff: removal.staysStaff, reason: input.reason }),
  ], { owner: input.owner, removing: fromUserId })
  return { tenant: await getTenant(db, tenantId), temporaryPassword: plan.temporaryPassword }
}

// --- Internal notes (step P2, D189) ---

const NOTE_FIELDS = ['contactName', 'contactPhone', 'notes'] as const

/**
 * Replaces the platform team's notes about a cafe, at the notes' version read (0 before the first
 * save). The audit row names the fields changed, never their values (a phone is personal data).
 */
export async function updateTenantNotes(db: Db, actor: PlatformActor, tenantId: string, input: UpdateTenantNotesInput, now = new Date()): Promise<TenantDetail> {
  if (!await repo.findTenant(db, tenantId)) throw tenantNotFound()
  const current = notesOf(await repo.findNotes(db, tenantId))
  if (current.version !== input.version) throw notesChanged()
  const values = { contactName: input.contactName, contactPhone: input.contactPhone, notes: input.notes, updatedBy: actor.userId, now }
  const fields = NOTE_FIELDS.filter(field => current[field] !== input[field])
  const statements: Statement[] = input.version === 0
    ? [repo.insertNotesStatement(db, tenantId, values)]
    : [repo.updateNotesStatement(db, tenantId, input.version, values), requireOneChange(db)]
  statements.push(audit(db, actor, tenantId, 'tenant.notes.update', { fields }))
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Someone saved them first: the first save's key, or a later one's version.
    if (isUniqueViolation(error) || isStaleWrite(error)) throw notesChanged()
    throw error
  }
  return getTenant(db, tenantId)
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

// --- The cafe's profile (step T2b, D143): its name and logo ---

async function profileOf(db: Db, row: TenantRow): Promise<CafeSettings> {
  const urls = row.logoAssetId ? await assetUrls(db, row.id, [row.logoAssetId]) : new Map<string, string>()
  return {
    slug: row.slug,
    name: row.name,
    logoUrl: (row.logoAssetId && urls.get(row.logoAssetId)) || null,
    logoAssetId: row.logoAssetId ?? null,
    status: statusOf(row),
    version: versionOf(row),
  }
}

/**
 * A cafe's name and logo for its pages, by its address (`GET /api/cafes/{slug}`). Public: anyone
 * may see a cafe's name. A paused cafe answers too (its pages say it's paused, by name); an
 * unknown address is 404.
 */
export async function getCafeProfile(db: Db, slug: string): Promise<CafeProfile> {
  const row = await repo.findTenantBySlug(db, slug)
  if (!row) throw tenantNotFound()
  const { logoAssetId: _, version: __, ...profile } = await profileOf(db, row)
  return profile
}

/**
 * The cafes the signed-in account works in, by name, with the workspaces it may open in each
 * (`GET /api/me/cafes`, T2c, D144): for Your cafes and the cafe switcher. Only links: each
 * workspace checks access on its own routes. A paused cafe is listed with its status.
 */
export async function listAccountCafes(db: Db, user: SessionUser | null | undefined): Promise<AccountCafe[]> {
  const entries = await accountWorkspaces(db, user)
  // One read per cafe: an account works in a handful, and a list of ids would meet D1's parameter limit.
  const cafes = await Promise.all(entries.map(async ({ tenantId, workspaces }) => {
    const row = await repo.findTenant(db, tenantId)
    if (!row) return null
    const { logoAssetId: _, version: __, ...profile } = await profileOf(db, row)
    return { ...profile, workspaces }
  }))
  return cafes.filter(cafe => cafe !== null).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug))
}

/** The owner's settings page (`GET /api/c/<slug>/admin/cafe`). */
export async function getCafeSettings(db: Db, tenantId: string): Promise<CafeSettings> {
  const row = await repo.findTenant(db, tenantId)
  if (!row) throw tenantNotFound()
  return profileOf(db, row)
}

/**
 * The owner changes the cafe's name and logo. The logo is an upload of this cafe's (attached
 * here, the old one released), in the same batch as the change and its audit row. The address is
 * the platform team's to change (`changeTenantSlug`).
 */
export async function updateCafeSettings(db: Db, actor: Actor, input: UpdateCafeInput): Promise<CafeSettings> {
  const { tenantId } = actor
  const row = await loadForChange(db, tenantId, input.version)
  const logoChanged = (row.logoAssetId ?? null) !== input.logoAssetId
  const logoStatements = logoChanged
    ? [
        ...(row.logoAssetId ? [releaseStatement(db, tenantId, row.logoAssetId)] : []),
        ...(input.logoAssetId ? await attachStatements(db, tenantId, input.logoAssetId, 'logoAssetId') : []),
      ]
    : []
  try {
    await db.batch([
      repo.updateTenantStatement(db, tenantId, input.version, { name: input.name, logoAssetId: input.logoAssetId }),
      requireOneChange(db),
      ...logoStatements,
      auditStatement(db, { userId: actor.userId, tenantId, requestId: actor.requestId }, {
        action: 'tenant.profile.update',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: { name: input.name, logoChanged },
      }),
    ])
  }
  catch (error) {
    if (!isStaleWrite(error)) throw error
    // Either someone changed the cafe, or the upload was cleaned up or used meanwhile.
    const current = await repo.findTenant(db, tenantId)
    if (versionOf(current ?? row) !== input.version) throw tenantChanged()
    throw mediaNotAvailable('logoAssetId')
  }
  return getCafeSettings(db, tenantId)
}
