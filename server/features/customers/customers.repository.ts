import { eq } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { firstRow, inTenant } from '#server/utils/query'
import { customerProfiles } from './customers.schema'

// --- Row types ---

export interface ProfileRow {
  tenantId: string
  userId: string
  memberCode: string
  phone: string | null
  marketingOptIn: boolean
  createdAt: Date
}

// --- Column lists and conditions ---

const profileColumns = {
  tenantId: customerProfiles.tenantId,
  userId: customerProfiles.userId,
  memberCode: customerProfiles.memberCode,
  phone: customerProfiles.phone,
  marketingOptIn: customerProfiles.marketingOptIn,
  createdAt: customerProfiles.createdAt,
}

// --- Reads ---

/** The account's profile in the tenant. */
export async function findProfile(db: Db, tenantId: string, userId: string): Promise<ProfileRow | undefined> {
  return firstRow(db
    .select(profileColumns)
    .from(customerProfiles)
    .where(inTenant(customerProfiles, tenantId, eq(customerProfiles.userId, userId))))
}

// --- Write statements ---

/**
 * Creates the profile unless the account has one in the tenant already (`on conflict (tenant_id,
 * user_id) do nothing`), so the sign-up hook and the create-if-missing path can both run without
 * harm. A member code that collides with another account's in the tenant still fails (unique
 * index), and the caller retries with a new one.
 */
export function insertProfileStatement(db: Db, tenantId: string, userId: string, memberCode: string): Statement {
  return db.insert(customerProfiles).values({ tenantId, userId, memberCode }).onConflictDoNothing({ target: [customerProfiles.tenantId, customerProfiles.userId] })
}
