import { hashPassword } from 'better-auth/crypto'
import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { BranchRoleName, CreatedStaff, CreateStaffInput, DisableStaffInput, StaffListQuery, StaffMember, UpdateStaffAccessInput } from '#shared/contracts/staff'
import type { Db, Statement } from '../../utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { toIso } from '../../utils/time'
import { profileStatement } from '../customers'
import { auditStatement } from '../platform'
import type { AuditActor } from '../platform'
import type { Actor } from './identity.types'
import { lastAdmin, ownAccess, staffAlreadyExists, staffChanged, staffNotFound, unknownBranches } from './staff.errors'
import * as repo from './staff.repository'
import type { AccountRow, MembershipRow } from './staff.repository'
import { generateTemporaryPassword, isPlatformAdmin, nextVersion } from './staff.rules'

/**
 * Staff management (docs/server/security.md → Staff onboarding, D49). Only platform admins reach
 * these (`staff:create|update|disable`); the actor is always an admin.
 */

type Memberships = { branchId: string, role: BranchRoleName }[]

function toStaffMember(row: AccountRow, memberships: MembershipRow[]): StaffMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    admin: isPlatformAdmin(row.role),
    memberships: memberships.filter(m => m.userId === row.id).map(m => ({ branchId: m.branchId, branchName: m.branchName, role: m.role as BranchRoleName })),
    mustChangePassword: Boolean(row.mustChangePassword),
    version: row.updatedAt.getTime(),
    createdAt: toIso(row.createdAt),
  }
}

async function loadStaffMember(db: Db, userId: string): Promise<StaffMember> {
  const row = await repo.findAccount(db, userId)
  if (!row) throw staffNotFound()
  return toStaffMember(row, await repo.membershipsOf(db, [userId]))
}

async function ensureActiveBranches(db: Db, memberships: Memberships) {
  const active = await repo.activeBranchIds(db, memberships.map(m => m.branchId))
  const missing = memberships.flatMap((m, i) => active.has(m.branchId) ? [] : [i])
  if (missing.length) throw unknownBranches(missing)
}

const staffAudit = (db: Db, by: AuditActor, action: string, userId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, by, { action, targetType: 'user', targetId: userId, metadata })

const accessMetadata = (admin: boolean, memberships: Memberships) => ({ admin, memberships })

/**
 * Runs a batch that changes an account's access. A guard failure is either a stale version (someone
 * changed the account) or the last-admin guard; which one is told apart by reading the account again.
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

export async function listStaff(db: Db, query: StaffListQuery): Promise<Page<StaffMember>> {
  const { rows, total } = await repo.listStaff(db, query)
  const memberships = await repo.membershipsOf(db, rows.map(r => r.id))
  return {
    items: rows.map(row => toStaffMember(row, memberships)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: totalPages(total, query.pageSize),
  }
}

export async function getStaffMember(db: Db, userId: string): Promise<StaffMember> {
  return loadStaffMember(db, userId)
}

/**
 * Creates a staff account with a temporary password, or gives access to an existing account with
 * that email (a customer who also works at the cafe: they keep their password; D49).
 */
export async function createStaff(db: Db, actor: Actor, input: CreateStaffInput): Promise<CreatedStaff> {
  return createStaffAs(db, actor, input)
}

/** `userId: null`: the system (the seed task). */
async function createStaffAs(db: Db, by: AuditActor, input: CreateStaffInput): Promise<CreatedStaff> {
  await ensureActiveBranches(db, input.memberships)
  const existing = await repo.findAccountByEmail(db, input.email)
  const now = new Date()

  if (existing) {
    const current = await repo.membershipsOf(db, [existing.id])
    if (isPlatformAdmin(existing.role) || current.length) throw staffAlreadyExists()
    const statements: Statement[] = [
      repo.setPlatformRoleStatement(db, existing.id, input.admin, existing.updatedAt, nextVersion(existing.updatedAt, now)),
      requireOneChange(db),
      ...repo.replaceMembershipsStatements(db, existing.id, input.memberships, now),
      staffAudit(db, by, 'staff.create', existing.id, { ...accessMetadata(input.admin, input.memberships), existingAccount: true }),
    ]
    await runAccessBatch(db, statements, existing.id, existing.updatedAt.getTime())
    return { staff: await loadStaffMember(db, existing.id), temporaryPassword: null }
  }

  const userId = newId()
  const temporaryPassword = generateTemporaryPassword()
  const statements: Statement[] = [
    ...repo.insertAccountStatements(db, { id: userId, name: input.name, email: input.email, admin: input.admin, passwordHash: await hashPassword(temporaryPassword), now }),
    // Better Auth's sign-up hook doesn't run for these writes (D49).
    profileStatement(db, userId),
    ...repo.replaceMembershipsStatements(db, userId, input.memberships, now),
    staffAudit(db, by, 'staff.create', userId, { ...accessMetadata(input.admin, input.memberships), existingAccount: false }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Someone created an account with this email meanwhile.
    if (isUniqueViolation(error)) throw staffAlreadyExists()
    throw error
  }
  return { staff: await loadStaffMember(db, userId), temporaryPassword }
}

/**
 * Replaces a person's access (admin role and branch memberships). Their other sessions end, so a
 * removed role can't linger; an admin editing their own branches stays signed in.
 */
export async function updateStaffAccess(db: Db, actor: Actor, userId: string, input: UpdateStaffAccessInput): Promise<StaffMember> {
  const target = await repo.findAccount(db, userId)
  if (!target) throw staffNotFound()
  if (target.updatedAt.getTime() !== input.version) throw staffChanged()
  const self = actor.userId === userId
  if (self && !input.admin) throw ownAccess('remove admin')
  await ensureActiveBranches(db, input.memberships)

  const now = new Date()
  const statements: Statement[] = [
    repo.setPlatformRoleStatement(db, userId, input.admin, target.updatedAt, nextVersion(target.updatedAt, now)),
    requireOneChange(db),
    ...repo.replaceMembershipsStatements(db, userId, input.memberships, now),
    repo.requireAnAdminStatement(db),
    ...(self ? [] : [repo.deleteSessionsStatement(db, userId)]),
    staffAudit(db, actor, 'staff.access.update', userId, accessMetadata(input.admin, input.memberships)),
  ]
  await runAccessBatch(db, statements, userId, input.version)
  return loadStaffMember(db, userId)
}

/**
 * Takes all staff access away: the admin role and every membership, and signs them out
 * everywhere. The account stays, as a customer account (security.md → Staff onboarding).
 */
export async function disableStaff(db: Db, actor: Actor, userId: string, input: DisableStaffInput): Promise<void> {
  if (actor.userId === userId) throw ownAccess('disable')
  const target = await repo.findAccount(db, userId)
  if (!target) throw staffNotFound()
  if (target.updatedAt.getTime() !== input.version) throw staffChanged()

  const statements: Statement[] = [
    repo.setPlatformRoleStatement(db, userId, false, target.updatedAt, nextVersion(target.updatedAt)),
    requireOneChange(db),
    ...repo.replaceMembershipsStatements(db, userId, [], new Date()),
    repo.requireAnAdminStatement(db),
    repo.deleteSessionsStatement(db, userId),
    staffAudit(db, actor, 'staff.disable', userId, {}),
  ]
  await runAccessBatch(db, statements, userId, input.version)
}

/**
 * The seed task: the first admin, with a temporary password printed once. Does nothing (returns
 * `null`) when an admin already exists, so it can run on every deploy of a disposable environment.
 */
export async function seedFirstAdmin(db: Db, input: { name: string, email: string }): Promise<CreatedStaff | null> {
  if (await repo.countAdmins(db) > 0) return null
  return createStaffAs(db, { userId: null }, { ...input, email: input.email.trim().toLowerCase(), admin: true, memberships: [] })
}
