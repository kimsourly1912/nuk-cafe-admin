import { hashPassword } from 'better-auth/crypto'
import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { BranchRoleName, CreatedStaff, CreateStaffInput, DisableStaffInput, ResetStaffPasswordInput, StaffListQuery, StaffMember, StaffPasswordReset, UpdateStaffAccessInput } from '#shared/contracts/staff'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import { profileStatement } from '#server/features/customers'
import { auditStatement } from '#server/features/platform'
import type { AuditActor } from '#server/features/platform'
import type { Actor } from './identity.types'
import { lastAdmin, ownAccess, staffAlreadyExists, staffChanged, staffElsewhere, staffNotFound, unknownBranches } from './staff.errors'
import * as repo from './staff.repository'
import type { AccountRow, MembershipRow } from './staff.repository'
import { generateTemporaryPassword, isSuperadmin, nextVersion } from './staff.rules'

/**
 * Staff management (docs/server/security.md → Staff onboarding, D49, D134), in one tenant. Only its
 * owners reach these (`staff:create|update|disable`). "Admin" in the contract and the screens is
 * the tenant's `owner` role. Owners manage **memberships**: an account can belong to other
 * tenants too, so changes to the account itself (a password) are limited to accounts of this tenant
 * alone.
 */

type Memberships = { branchId: string, role: BranchRoleName }[]

function toStaffMember(row: AccountRow, owners: Set<string>, memberships: MembershipRow[]): StaffMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    admin: owners.has(row.id),
    memberships: memberships.filter(m => m.userId === row.id).map(m => ({ branchId: m.branchId, branchName: m.branchName, role: m.role as BranchRoleName })),
    mustChangePassword: Boolean(row.mustChangePassword),
    version: row.updatedAt.getTime(),
    createdAt: toIso(row.createdAt),
  }
}

/** A member of the tenant, else 404: another tenant's people don't exist here. */
async function loadStaffMember(db: Db, tenantId: string, userId: string): Promise<StaffMember> {
  const row = await repo.findAccount(db, userId)
  if (!row || !await repo.tenantRoleOf(db, tenantId, userId)) throw staffNotFound()
  return toStaffMember(row, await repo.ownersAmong(db, tenantId, [userId]), await repo.membershipsOf(db, tenantId, [userId]))
}

async function ensureActiveBranches(db: Db, tenantId: string, memberships: Memberships) {
  const active = await repo.activeBranchIds(db, tenantId, memberships.map(m => m.branchId))
  const missing = memberships.flatMap((m, i) => active.has(m.branchId) ? [] : [i])
  if (missing.length) throw unknownBranches(missing)
}

const staffAudit = (db: Db, by: AuditActor, tenantId: string, action: string, userId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, by, { action, targetType: 'user', targetId: userId, metadata: { ...metadata, tenantId } })

const tenantRole = (admin: boolean) => admin ? 'owner' as const : 'member' as const

const accessMetadata = (admin: boolean, memberships: Memberships) => ({ admin, memberships })

/**
 * Runs a batch that changes an account's access. A guard failure is either a stale version (someone
 * changed the account) or the last-owner guard; which one is told apart by reading the account again.
 */
async function runAccessBatch(db: Db, statements: Statement[], userId: string, expectedVersion: number) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (!isStaleWrite(error)) throw error
    const current = await repo.findAccount(db, userId)
    if (!current) throw staffNotFound()
    if (current.updatedAt.getTime() !== expectedVersion) throw staffChanged()
    throw lastAdmin()
  }
}

export async function listStaff(db: Db, actor: Actor, query: StaffListQuery): Promise<Page<StaffMember>> {
  const { rows, total } = await repo.listStaff(db, actor.tenantId, query)
  const ids = rows.map(r => r.id)
  const [owners, memberships] = await Promise.all([repo.ownersAmong(db, actor.tenantId, ids), repo.membershipsOf(db, actor.tenantId, ids)])
  return {
    items: rows.map(row => toStaffMember(row, owners, memberships)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: totalPages(total, query.pageSize),
  }
}

export async function getStaffMember(db: Db, actor: Actor, userId: string): Promise<StaffMember> {
  return loadStaffMember(db, actor.tenantId, userId)
}

/**
 * Creates a staff account with a temporary password, or gives access to an existing account with
 * that email (a customer, or someone working at another cafe: they keep their password; D49).
 */
export async function createStaff(db: Db, actor: Actor, input: CreateStaffInput): Promise<CreatedStaff> {
  return createStaffAs(db, actor, actor.tenantId, input)
}

/** `userId: null`: the system (the seed task). */
async function createStaffAs(db: Db, by: AuditActor, tenantId: string, input: CreateStaffInput): Promise<CreatedStaff> {
  await ensureActiveBranches(db, tenantId, input.memberships)
  const existing = await repo.findAccountByEmail(db, input.email)
  const now = new Date()

  if (existing) {
    if (await repo.tenantRoleOf(db, tenantId, existing.id)) throw staffAlreadyExists()
    const statements: Statement[] = [
      repo.bumpVersionStatement(db, existing.id, existing.updatedAt, nextVersion(existing.updatedAt, now)),
      requireOneChange(db),
      ...repo.replaceAccessStatements(db, tenantId, existing.id, tenantRole(input.admin), input.memberships, now),
      staffAudit(db, by, tenantId, 'staff.create', existing.id, { ...accessMetadata(input.admin, input.memberships), existingAccount: true }),
    ]
    await runAccessBatch(db, statements, existing.id, existing.updatedAt.getTime())
    return { staff: await loadStaffMember(db, tenantId, existing.id), temporaryPassword: null }
  }

  const userId = newId()
  const temporaryPassword = generateTemporaryPassword()
  const statements: Statement[] = [
    ...repo.insertAccountStatements(db, { id: userId, name: input.name, email: input.email, passwordHash: await hashPassword(temporaryPassword), now }),
    // Better Auth's sign-up hook doesn't run for these writes (D49).
    profileStatement(db, userId),
    ...repo.replaceAccessStatements(db, tenantId, userId, tenantRole(input.admin), input.memberships, now),
    staffAudit(db, by, tenantId, 'staff.create', userId, { ...accessMetadata(input.admin, input.memberships), existingAccount: false }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Someone created an account with this email meanwhile.
    if (isUniqueViolation(error)) throw staffAlreadyExists()
    throw error
  }
  return { staff: await loadStaffMember(db, tenantId, userId), temporaryPassword }
}

/**
 * Replaces a person's access (admin role and branch memberships). Their other sessions end, so a
 * removed role can't linger; an admin editing their own branches stays signed in.
 */
export async function updateStaffAccess(db: Db, actor: Actor, userId: string, input: UpdateStaffAccessInput): Promise<StaffMember> {
  const { tenantId } = actor
  const target = await repo.findAccount(db, userId)
  if (!target || !await repo.tenantRoleOf(db, tenantId, userId)) throw staffNotFound()
  if (target.updatedAt.getTime() !== input.version) throw staffChanged()
  const self = actor.userId === userId
  if (self && !input.admin) throw ownAccess('remove admin')
  await ensureActiveBranches(db, tenantId, input.memberships)

  const now = new Date()
  const statements: Statement[] = [
    repo.bumpVersionStatement(db, userId, target.updatedAt, nextVersion(target.updatedAt, now)),
    requireOneChange(db),
    ...repo.replaceAccessStatements(db, tenantId, userId, tenantRole(input.admin), input.memberships, now),
    repo.requireAnOwnerStatement(db, tenantId),
    ...(self ? [] : [repo.deleteSessionsStatement(db, userId)]),
    staffAudit(db, actor, tenantId, 'staff.access.update', userId, accessMetadata(input.admin, input.memberships)),
  ]
  await runAccessBatch(db, statements, userId, input.version)
  return loadStaffMember(db, tenantId, userId)
}

/**
 * Takes all staff access to this tenant away: the membership and every branch, and signs them out
 * everywhere (a session can't be ended for one cafe only). The account stays, as a customer
 * account, with any other cafe's access (security.md → Staff onboarding).
 */
export async function disableStaff(db: Db, actor: Actor, userId: string, input: DisableStaffInput): Promise<void> {
  const { tenantId } = actor
  if (actor.userId === userId) throw ownAccess('disable')
  const target = await repo.findAccount(db, userId)
  if (!target || !await repo.tenantRoleOf(db, tenantId, userId)) throw staffNotFound()
  if (target.updatedAt.getTime() !== input.version) throw staffChanged()

  const statements: Statement[] = [
    repo.bumpVersionStatement(db, userId, target.updatedAt, nextVersion(target.updatedAt)),
    requireOneChange(db),
    ...repo.replaceAccessStatements(db, tenantId, userId, null, [], new Date()),
    repo.requireAnOwnerStatement(db, tenantId),
    repo.deleteSessionsStatement(db, userId),
    staffAudit(db, actor, tenantId, 'staff.disable', userId, {}),
  ]
  await runAccessBatch(db, statements, userId, input.version)
}

/**
 * Gives a staff member a new temporary password (step 10.1, D115), for one who forgot theirs: staff
 * can't reset it by email until the cafe has a sending domain (Q4), and an admin hands it over in
 * person anyway. They must choose their own at the next sign-in, and every session they had ends,
 * so the old password (or whoever knew it) is out at once. Only for staff (a customer resets by
 * email), never one's own (Change password), and audited without the password. The password opens
 * every cafe the account belongs to, so only for an account of **this** cafe alone (D134): someone
 * who also works elsewhere, or a super admin, resets their own by email.
 */
export async function resetStaffPassword(db: Db, actor: Actor, userId: string, input: ResetStaffPasswordInput): Promise<StaffPasswordReset> {
  const { tenantId } = actor
  if (actor.userId === userId) throw ownAccess('reset password')
  const target = await repo.findAccount(db, userId)
  if (!target || !await repo.tenantRoleOf(db, tenantId, userId)) throw staffNotFound()
  if (isSuperadmin(target.role) || await repo.hasAccessElsewhere(db, tenantId, userId)) throw staffElsewhere()
  if (target.updatedAt.getTime() !== input.version) throw staffChanged()

  const temporaryPassword = generateTemporaryPassword()
  const now = new Date()
  const statements: Statement[] = [
    repo.requirePasswordChangeStatement(db, userId, target.updatedAt, nextVersion(target.updatedAt, now)),
    requireOneChange(db),
    repo.setPasswordStatement(db, userId, await hashPassword(temporaryPassword), now, await repo.hasPasswordAccount(db, userId)),
    repo.deleteSessionsStatement(db, userId),
    staffAudit(db, actor, tenantId, 'staff.password.reset', userId, {}),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Someone changed the account between the read and the write.
    if (isStaleWrite(error)) throw staffChanged()
    throw error
  }
  return { staff: await loadStaffMember(db, tenantId, userId), temporaryPassword }
}

/**
 * The seed task's tenant (D134): the oldest one, or "NUK Cafe" (`nuk`) when none exists yet.
 */
export async function seedTenant(db: Db, input: { name: string, slug: string }): Promise<{ id: string, name: string, slug: string, created: boolean }> {
  const existing = await repo.findAnyTenant(db)
  if (existing) return { ...existing, created: false }
  const tenant = { id: newId(), name: input.name, slug: input.slug, now: new Date() }
  await db.batch([repo.insertTenantStatement(db, tenant)])
  return { id: tenant.id, name: tenant.name, slug: tenant.slug, created: true }
}

/**
 * The seed task: the tenant's first owner, with a temporary password printed once. Does nothing
 * (returns `null`) when the tenant has an owner, so it can run on every deploy of a disposable
 * environment.
 */
export async function seedFirstOwner(db: Db, tenantId: string, input: { name: string, email: string }): Promise<CreatedStaff | null> {
  if (await repo.countOwners(db, tenantId) > 0) return null
  return createStaffAs(db, { userId: null }, tenantId, { ...input, email: input.email.trim().toLowerCase(), admin: true, memberships: [] })
}
