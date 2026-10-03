import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '#server/utils/batch'
import { branches, branchStaff, member, organization } from '#server/db/tables'

export interface TenantRow {
  id: string
  slug: string
  name: string
  status: string | null
}

/**
 * The tenant the request acts in, until addresses name one (T1.5, D134): the oldest tenant. Only
 * one exists before the platform console (T2).
 */
export async function findCurrentTenant(db: Db): Promise<TenantRow | undefined> {
  const rows: TenantRow[] = await db
    .select({ id: organization.id, slug: organization.slug, name: organization.name, status: organization.status })
    .from(organization)
    .orderBy(asc(organization.createdAt), asc(organization.id))
    .limit(1)
  return rows[0]
}

/** The tenant a path names (`/api/c/<slug>/…`, D140); `undefined` when no tenant has that slug. */
export async function findTenantBySlug(db: Db, slug: string): Promise<TenantRow | undefined> {
  const rows: TenantRow[] = await db
    .select({ id: organization.id, slug: organization.slug, name: organization.name, status: organization.status })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1)
  return rows[0]
}

/** Every active tenant, oldest first (platform tasks that work per tenant, D138). */
export async function findActiveTenants(db: Db): Promise<{ id: string, slug: string, name: string }[]> {
  const rows: TenantRow[] = await db
    .select({ id: organization.id, slug: organization.slug, name: organization.name, status: organization.status })
    .from(organization)
    .orderBy(asc(organization.createdAt), asc(organization.id))
  return rows.filter(row => (row.status ?? 'active') === 'active').map(({ status: _, ...tenant }) => tenant)
}

/** The user's role in the tenant (`owner`, `member`), `undefined` when not a member. */
export async function findTenantRole(db: Db, tenantId: string, userId: string): Promise<string | undefined> {
  const rows = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))
    .limit(1)
  return rows[0]?.role
}

export interface BranchAccessRow {
  status: string
  /** The user's role at the branch (`branch_staff`), `null` when they don't work there. */
  staffRole: string | null
}

/** The branch's status and the user's role at it, in one query; `undefined` when the tenant has no such branch. */
export async function findBranchAccess(db: Db, tenantId: string, branchId: string, userId: string): Promise<BranchAccessRow | undefined> {
  const rows: BranchAccessRow[] = await db
    .select({ status: branches.status, staffRole: branchStaff.role })
    .from(branches)
    .leftJoin(branchStaff, and(eq(branchStaff.branchId, branches.id), eq(branchStaff.userId, userId)))
    .where(and(eq(branches.tenantId, tenantId), eq(branches.id, branchId)))
    .limit(1)
  return rows[0]
}

/** The tenant's active branches a user works at, with their role, by name. */
export async function staffBranches(db: Db, tenantId: string, userId: string): Promise<{ id: string, name: string, role: string }[]> {
  return db.select({ id: branches.id, name: branches.name, role: branchStaff.role })
    .from(branchStaff)
    .innerJoin(branches, eq(branches.id, branchStaff.branchId))
    .where(and(eq(branchStaff.tenantId, tenantId), eq(branchStaff.userId, userId), eq(branches.status, 'active')))
    .orderBy(asc(branches.name))
}

/** The tenant's active branches, by name (an owner works at all of them). */
export async function activeBranches(db: Db, tenantId: string): Promise<{ id: string, name: string }[]> {
  return db.select({ id: branches.id, name: branches.name }).from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.status, 'active'))).orderBy(asc(branches.name))
}
