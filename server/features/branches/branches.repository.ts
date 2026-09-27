import { asc, eq } from 'drizzle-orm'
import type { Db, Statement } from '../../utils/batch'
import { organization } from '../../db/tables'

/**
 * Branches are Better Auth organizations (D44). Step 5.1 adds branch settings and dining tables;
 * for now the seed task is the only writer.
 */

export async function hasAnyBranch(db: Db): Promise<boolean> {
  const rows = await db.select({ id: organization.id }).from(organization).limit(1)
  return rows.length > 0
}

export function insertBranchStatement(db: Db, row: { id: string, name: string, slug: string, timezone: string, now: Date }): Statement {
  return db.insert(organization).values({
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    currency: 'USD',
    status: 'active',
    createdAt: row.now,
  })
}

export interface BranchOptionRow {
  id: string
  name: string
}

/** Active branches by name, for pickers. */
export async function listActiveBranches(db: Db): Promise<BranchOptionRow[]> {
  return db.select({ id: organization.id, name: organization.name }).from(organization)
    .where(eq(organization.status, 'active'))
    .orderBy(asc(organization.name))
}
