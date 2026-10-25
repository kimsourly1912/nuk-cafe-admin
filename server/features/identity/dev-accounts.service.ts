import { hashPassword } from 'better-auth/crypto'
import type { BranchRoleName } from '#shared/contracts/staff'
import type { Db, Statement } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { profileStatement } from '#server/features/customers'
import { auditStatement } from '#server/features/platform'
import { signInResetStatements } from './dev-accounts.repository'
import * as repo from './staff.repository'
import { nextVersion } from './staff.rules'

/**
 * Test accounts for the dev server (docs/reference/auth.md → Test accounts, D209): one per role,
 * all with one known password, and a reset that gets any account signed in again. Every function
 * takes `dev` (`import.meta.dev` from the task) and refuses without it: these write a password
 * anyone can read in the docs.
 */

/** The password every test account gets, unless `NUXT_DEV_ACCOUNTS_PASSWORD` names another. */
export const DEV_PASSWORD = 'nuk-dev-password'

export type DevAccountRole = 'superadmin' | 'owner' | 'manager' | 'staff' | 'customer'

export interface DevAccountSpec {
  email: string
  name: string
  role: DevAccountRole
  /** The cafe it works at or is a customer of; none for a super admin. */
  tenantId?: string
  /** The branch of a manager or staff member. */
  branchId?: string
}

export interface DevAccount {
  userId: string
  email: string
  role: DevAccountRole
  created: boolean
}

function requireDev(dev: boolean) {
  if (!dev) throw new Error('Test accounts exist on the dev server only.')
}

const devAudit = (db: Db, userId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, { userId: null, tenantId: null }, { action: 'dev.account.reset', targetType: 'user', targetId: userId, metadata })

/** The writes that give the account exactly its role's access in its cafe. */
function accessStatements(db: Db, spec: DevAccountSpec, userId: string, now: Date): Statement[] {
  if (!spec.tenantId) return []
  const branchRole: BranchRoleName | null = spec.role === 'manager' || spec.role === 'staff' ? spec.role : null
  if (branchRole && !spec.branchId) throw new Error(`A ${branchRole} needs a branch.`)
  const tenantRole = spec.role === 'owner' ? 'owner' : branchRole ? 'member' : null
  const memberships = branchRole ? [{ branchId: spec.branchId!, role: branchRole }] : []
  return [
    ...repo.replaceAccessStatements(db, spec.tenantId, userId, tenantRole, memberships, now),
    profileStatement(db, spec.tenantId, userId),
  ]
}

/**
 * Creates the account, or puts an existing one back: the password, its role's access in its cafe
 * (and no staff access there otherwise), no forced change, no two-step sign-in, not banned, signed
 * out everywhere. One batch per account.
 */
export async function resetDevAccount(db: Db, spec: DevAccountSpec, options: { dev: boolean, password: string }): Promise<DevAccount> {
  requireDev(options.dev)
  const email = spec.email.trim().toLowerCase()
  const existing = await repo.findAccountByEmail(db, email)
  const userId = existing?.id ?? newId()
  const now = new Date()
  const passwordHash = await hashPassword(options.password)
  const platformRole = spec.role === 'superadmin' ? 'superadmin' : 'customer'
  const statements: Statement[] = [
    ...existing
      ? [repo.setPasswordStatement(db, userId, passwordHash, now, await repo.hasPasswordAccount(db, userId))]
      : repo.insertAccountStatements(db, { id: userId, name: spec.name, email, passwordHash, now }),
    ...signInResetStatements(db, userId, existing ? nextVersion(existing.updatedAt, now) : now, platformRole),
    repo.deleteSessionsStatement(db, userId),
    ...accessStatements(db, spec, userId, now),
    devAudit(db, userId, { role: spec.role, tenantId: spec.tenantId ?? null, created: !existing }),
  ]
  await db.batch(statements as [Statement, ...Statement[]])
  return { userId, email, role: spec.role, created: !existing }
}

/**
 * Any account back to signing in with `password` (one made in the app too): the same reset as a
 * test account's, keeping its roles and access.
 */
export async function resetDevSignIn(db: Db, email: string, options: { dev: boolean, password: string }): Promise<{ userId: string, email: string }> {
  requireDev(options.dev)
  const target = await repo.findAccountByEmail(db, email.trim().toLowerCase())
  if (!target) throw new Error(`No account has the email ${email}.`)
  const now = new Date()
  await db.batch([
    repo.setPasswordStatement(db, target.id, await hashPassword(options.password), now, await repo.hasPasswordAccount(db, target.id)),
    ...signInResetStatements(db, target.id, nextVersion(target.updatedAt, now)),
    repo.deleteSessionsStatement(db, target.id),
    devAudit(db, target.id, { signInOnly: true }),
  ])
  return { userId: target.id, email: target.email }
}
