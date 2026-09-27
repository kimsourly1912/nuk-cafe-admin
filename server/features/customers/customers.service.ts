import type { Db, Statement } from '../../utils/batch'
import { isUniqueViolation } from '../../utils/batch'
import { toIso } from '../../utils/time'
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
 * The profile statement for a new account, to put in the batch that creates it (staff creation).
 * Does nothing if the account has a profile already.
 */
export function profileStatement(db: Db, userId: string): Statement {
  return repo.insertProfileStatement(db, userId, generateMemberCode())
}

/**
 * Makes sure the account has a profile, and returns it. Better Auth's sign-up hook runs after the
 * account is stored and D1 has no transactions, so a profile can be missing; every read goes
 * through here and creates it then. A member code collision (1 in a trillion) retries with another.
 */
export async function ensureProfile(db: Db, userId: string): Promise<CustomerProfile> {
  for (let attempt = 0; ; attempt++) {
    const existing = await repo.findProfile(db, userId)
    if (existing) return toProfile(existing)
    try {
      await db.batch([profileStatement(db, userId)])
    }
    catch (error) {
      if (!isUniqueViolation(error) || attempt >= 4) throw error
    }
  }
}
