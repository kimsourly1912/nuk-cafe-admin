import { and, asc, eq, exists, inArray, isNull, or } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { firstRow, inTenant } from '#server/utils/query'
import { branches, branchStaff, member, user } from '#server/db/tables'
import { activeBranch } from '#server/features/branches'

// --- Row types ---

export interface BranchAccessRow {
  status: string
  staffRole: string | null
}

export interface WorkspaceRoleRow {
  tenantId: string
  role: string
}

// --- Shared conditions ---

/** Better Auth's legacy null flags mean false. Ban expiry is handled at sign-in (D187). */
export const accountCanSignIn = or(eq(user.banned, false), isNull(user.banned))!
/** A registered account excludes anonymous carts, including legacy null flags. */
export const registeredAccount = or(eq(user.isAnonymous, false), isNull(user.isAnonymous))!

/** An owner's membership whose account can sign in; reused by reads and the last-owner guard. */
export const ownerCanSignIn = (db: Db): SQL => and(
  eq(member.role, 'owner'),
  exists(db.select({ id: user.id }).from(user).where(and(eq(user.id, member.userId), accountCanSignIn))),
)!

/** Across cafes: whether this cafe has an owner who can sign in (platform console). */
export const hasActiveOwner = (db: Db, tenant: AnyColumn): SQL =>
  inArray(tenant, db.select({ tenantId: member.organizationId }).from(member).where(ownerCanSignIn(db)))

// --- Reads ---

/** The user's role in the cafe. Uses member_organizationId_idx. */
export async function findTenantRole(db: Db, tenantId: string, userId: string): Promise<string | undefined> {
  return (await firstRow(db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))))?.role
}

/** The branch's status and the user's role there; another cafe's branch is absent. */
export function findBranchAccess(db: Db, tenantId: string, branchId: string, userId: string): Promise<BranchAccessRow | undefined> {
  return firstRow(db.select({ status: branches.status, staffRole: branchStaff.role }).from(branches)
    .leftJoin(branchStaff, and(
      eq(branchStaff.tenantId, branches.tenantId),
      eq(branchStaff.branchId, branches.id),
      eq(branchStaff.userId, userId),
    ))
    .where(inTenant(branches, tenantId, eq(branches.id, branchId))))
}

/** The cafe's active branches the user works at. Uses branch_staff_user_idx. */
export function listStaffBranches(db: Db, tenantId: string, userId: string): Promise<{ id: string, name: string, role: string }[]> {
  return db.select({ id: branches.id, name: branches.name, role: branchStaff.role }).from(branchStaff)
    .innerJoin(branches, and(eq(branches.tenantId, branchStaff.tenantId), eq(branches.id, branchStaff.branchId)))
    .where(inTenant(branchStaff, tenantId, eq(branchStaff.userId, userId), activeBranch))
    .orderBy(asc(branches.name), asc(branches.id))
}

/** Across cafes: the account's own memberships and active branch roles, in one snapshot. */
export async function workspaceRoles(db: Db, userId: string): Promise<{ memberships: WorkspaceRoleRow[], staff: WorkspaceRoleRow[] }> {
  const [memberships, staff] = await db.batch([
    db.select({ tenantId: member.organizationId, role: member.role }).from(member).where(eq(member.userId, userId)),
    db.selectDistinct({ tenantId: branchStaff.tenantId, role: branchStaff.role }).from(branchStaff)
      .innerJoin(branches, and(eq(branches.tenantId, branchStaff.tenantId), eq(branches.id, branchStaff.branchId)))
      .where(and(eq(branchStaff.userId, userId), activeBranch)),
  ])
  return { memberships, staff }
}

// --- Write statements ---

/** A guest's counter name (D156): never renames a registered account. */
export function updateGuestNameStatement(db: Db, userId: string, name: string, now: Date): Statement {
  return db.update(user).set({ name, updatedAt: now }).where(and(eq(user.id, userId), eq(user.isAnonymous, true)))
}
