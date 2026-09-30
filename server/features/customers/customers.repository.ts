import { eq } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { customerProfiles } from './customers.schema'

export interface ProfileRow {
  userId: string
  memberCode: string
  phone: string | null
  marketingOptIn: boolean
  createdAt: Date
}

export async function findProfile(db: Db, userId: string): Promise<ProfileRow | undefined> {
  const rows: ProfileRow[] = await db
    .select({ userId: customerProfiles.userId, memberCode: customerProfiles.memberCode, phone: customerProfiles.phone, marketingOptIn: customerProfiles.marketingOptIn, createdAt: customerProfiles.createdAt })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId))
    .limit(1)
  return rows[0]
}

/**
 * Creates the profile unless the account has one already (`on conflict (user_id) do nothing`), so
 * the sign-up hook and the create-if-missing path can both run without harm. A member code that
 * collides with another account's still fails (unique index), and the caller retries with a new one.
 */
export function insertProfileStatement(db: Db, userId: string, memberCode: string): Statement {
  return db.insert(customerProfiles).values({ userId, memberCode }).onConflictDoNothing({ target: customerProfiles.userId })
}
