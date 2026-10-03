import type { Db, Statement } from '#server/utils/batch'
import { isUniqueViolation } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import * as repo from './customers.repository'
import { generateMemberCode } from './customers.rules'

export interface CustomerProfile {
  memberCode: string
  phone: string | null
  marketingOptIn: boolean
  createdAt: string
}

const toProfile = (row: repo.ProfileRow): CustomerProfile =>
  ({ memberCode: row.memberCode, phone: row.phone, marketingOptIn: row.marketingOptIn, createdAt: toIso(row.createdAt) })

/**
 * The profile statement for an account joining a tenant, to put in the batch that does it (staff
 * creation). Does nothing if the account has a profile there already.
 */
export function profileStatement(db: Db, tenantId: string, userId: string): Statement {
  return repo.insertProfileStatement(db, tenantId, userId, generateMemberCode())
}

/**
 * Makes sure the account has a profile in the tenant, and returns it (one per account and cafe,
 * D137). Better Auth's sign-up hook runs after the account is stored and D1 has no transactions, so
 * a profile can be missing, and a customer of one cafe has none in the next until they use it;
 * every read goes through here and creates it then. A member code collision (1 in a trillion) retries with another.
 */
export async function ensureProfile(db: Db, tenantId: string, userId: string): Promise<CustomerProfile> {
  for (let attempt = 0; ; attempt++) {
    const existing = await repo.findProfile(db, tenantId, userId)
    if (existing) return toProfile(existing)
    try {
      await db.batch([profileStatement(db, tenantId, userId)])
    }
    catch (error) {
      if (!isUniqueViolation(error) || attempt >= 4) throw error
    }
  }
}
