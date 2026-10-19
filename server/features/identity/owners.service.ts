import { hashPassword } from 'better-auth/crypto'
import type { Db, Statement } from '#server/utils/batch'
import { requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { profileStatement } from '#server/features/customers'
import * as accountsRepo from './accounts.repository'
import * as repo from './staff.repository'
import { generateTemporaryPassword, isSuperadmin, nextVersion } from './staff.rules'

/**
 * A cafe's ownership as the platform console changes it (step P2, D189): the statements that make
 * an account an owner or take the ownership away, for the console's batch, which adds the cafe's
 * version, the last-owner guard and the audit row. Branch roles are never touched: an owner who
 * also works at a branch keeps that when the ownership goes.
 */

/** What the console needs to know about an account and a cafe before changing its ownership. */
export interface OwnershipFacts {
  userId: string
  /** The account's version (`updated_at`), guarded in the batch. */
  version: Date
  role: 'owner' | 'member' | undefined
  isSuperadmin: boolean
}

/** The account and its role in the tenant; `undefined` for an unknown account. */
export async function ownershipFacts(db: Db, tenantId: string, userId: string): Promise<OwnershipFacts | undefined> {
  const account = await repo.findAccount(db, userId)
  if (!account) return undefined
  const role = await repo.tenantRoleOf(db, tenantId, userId)
  return {
    userId,
    version: account.updatedAt,
    role: role === 'owner' || role === 'member' ? role : undefined,
    isSuperadmin: isSuperadmin(account.role),
  }
}

export interface OwnerAddPlan {
  userId: string
  /** A new account's temporary password, shown once; `null` for an existing account. */
  temporaryPassword: string | null
  statements: Statement[]
}

/**
 * Makes an existing account an owner: only at the version read and while it can still own a cafe
 * (not banned, not a guest), so a ban or another change meanwhile aborts the batch. It keeps its
 * branch roles here, its password and its other cafes; it gets a customer profile here (D137).
 */
export function planExistingOwner(db: Db, tenantId: string, facts: OwnershipFacts, now: Date): OwnerAddPlan {
  return {
    userId: facts.userId,
    temporaryPassword: null,
    statements: [
      repo.bumpVersionStatement(db, facts.userId, facts.version, nextVersion(facts.version, now)),
      requireOneChange(db),
      repo.requireEligibleAccountStatement(db, facts.userId),
      ...repo.setTenantRoleStatements(db, tenantId, facts.userId, 'owner', now),
      profileStatement(db, tenantId, facts.userId),
    ],
  }
}

/**
 * A new account as an owner, with a temporary password shown once (as D115): the email is the
 * account's unique key, so an account made with it meanwhile fails the batch as a unique violation.
 */
export async function planNewOwner(db: Db, tenantId: string, person: { name: string, email: string }, now: Date): Promise<OwnerAddPlan> {
  const userId = newId()
  const temporaryPassword = generateTemporaryPassword()
  return {
    userId,
    temporaryPassword,
    statements: [
      ...repo.insertAccountStatements(db, { id: userId, name: person.name, email: person.email, passwordHash: await hashPassword(temporaryPassword), now }),
      profileStatement(db, tenantId, userId),
      ...repo.setTenantRoleStatements(db, tenantId, userId, 'owner', now),
    ],
  }
}

/**
 * Takes an owner's ownership away, at the account's version read: they stay a member when they work
 * at one of the cafe's branches (their branch roles stay), otherwise they have no access here. Every
 * session of theirs ends, as when staff are disabled: a session can't be ended for one cafe only.
 * The caller adds `requireAnOwner` after it.
 */
export async function planOwnerRemoval(db: Db, tenantId: string, facts: OwnershipFacts, now: Date): Promise<{ staysStaff: boolean, statements: Statement[] }> {
  // Read before the batch: a branch role changed meanwhile moves the account's version, guarded below.
  const staysStaff = await repo.hasBranchRole(db, tenantId, facts.userId)
  return {
    staysStaff,
    statements: [
      repo.bumpVersionStatement(db, facts.userId, facts.version, nextVersion(facts.version, now)),
      requireOneChange(db),
      ...repo.setTenantRoleStatements(db, tenantId, facts.userId, staysStaff ? 'member' : null, now),
      repo.deleteSessionsStatement(db, facts.userId),
    ],
  }
}

/** Aborts the batch if it would leave the cafe without an owner who can sign in. */
export const requireAnOwner = repo.requireAnOwnerStatement

/** Owners able to sign in (not banned), per cafe; a cafe without one is missing from the map. */
export const activeOwnerCounts = accountsRepo.activeOwnerCounts
