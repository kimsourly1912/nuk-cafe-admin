import { and, eq } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { customerProfiles } from './customers.schema'

export interface ProfileRow {
  tenantId: string
  userId: string
  memberCode: string
  phone: string | null
  marketingOptIn: boolean
  createdAt: Date
}

/** The account's profile in the tenant. */
export async function findProfile(db: Db, tenantId: string, userId: string): Promise<ProfileRow | undefined> {
  const rows: ProfileRow[] = await db
    .select({ tenantId: customerProfiles.tenantId, userId: customerProfiles.userId, memberCode: customerProfiles.memberCode, phone: customerProfiles.phone, marketingOptIn: customerProfiles.marketingOptIn, createdAt: customerProfiles.createdAt })
    .from(customerProfiles)
    .where(and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.userId, userId)))
    .limit(1)
  return rows[0]
}

/**
 * Creates the profile unless the account has one in the tenant already (`on conflict (tenant_id,
 * user_id) do nothing`), so the sign-up hook and the create-if-missing path can both run without
 * harm. A member code that collides with another account's in the tenant still fails (unique
 * index), and the caller retries with a new one.
 */
export function insertProfileStatement(db: Db, tenantId: string, userId: string, memberCode: string): Statement {
  return db.insert(customerProfiles).values({ tenantId, userId, memberCode }).onConflictDoNothing({ target: [customerProfiles.tenantId, customerProfiles.userId] })
}
