import { and, eq, isNull } from 'drizzle-orm'
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

/**
 * Across cafes (an account is a person's, D137): the person's phone and marketing choice removed from
 * every cafe's profile, which is marked anonymised. The member code stays: it means nothing alone,
 * and the counter's lookups by code then find nobody to name.
 */
export function anonymizeProfilesStatement(db: Db, userId: string, now: Date): Statement {
  return db.update(customerProfiles)
    .set({ phone: null, marketingOptIn: false, anonymizedAt: now })
    .where(and(eq(customerProfiles.userId, userId), isNull(customerProfiles.anonymizedAt)))
}
