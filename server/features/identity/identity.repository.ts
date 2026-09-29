import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../../utils/batch'
import { member, organization } from '../../db/tables'

export interface BranchAccessRow {
  status: string | null
  /** The user's membership role in the branch, `null` when not a member. */
  memberRole: string | null
}

/** The branch's status and the user's role in it, in one query; `undefined` when no such branch. */
export async function findBranchAccess(db: Db, branchId: string, userId: string): Promise<BranchAccessRow | undefined> {
  const rows: BranchAccessRow[] = await db
    .select({ status: organization.status, memberRole: member.role })
    .from(organization)
    .leftJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
    .where(eq(organization.id, branchId))
    .limit(1)
  return rows[0]
}

/** The active branches a user is a member of, with their role, by name. */
export async function memberBranches(db: Db, userId: string): Promise<{ id: string, name: string, role: string }[]> {
  return db.select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), eq(organization.status, 'active')))
    .orderBy(asc(organization.name))
}

/** Every active branch, by name (a platform admin works at all of them). */
export async function activeBranches(db: Db): Promise<{ id: string, name: string }[]> {
  return db.select({ id: organization.id, name: organization.name }).from(organization)
    .where(eq(organization.status, 'active')).orderBy(asc(organization.name))
}
