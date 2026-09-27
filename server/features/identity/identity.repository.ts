import { and, eq } from 'drizzle-orm'
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
