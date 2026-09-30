import { and, asc, count, eq, exists, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { BranchRoleName, StaffListQuery } from '#shared/contracts/staff'
import type { Db, Statement } from '#server/utils/batch'
import { insertPieces, readInChunks, requireCount } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { account, member, organization, session, user } from '#server/db/tables'

/**
 * Staff queries (D49). Better Auth owns these tables' shape; staff management writes them directly
 * so that an account, its memberships, its sessions and the audit row change in **one batch**
 * (D1 has no transactions). Better Auth reads them per request, so changes apply at once.
 */

export interface AccountRow {
  id: string
  name: string
  email: string
  role: string | null
  mustChangePassword: boolean | null
  updatedAt: Date
  createdAt: Date
}

export interface MembershipRow {
  userId: string
  branchId: string
  branchName: string
  role: string
}

const accountColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  mustChangePassword: user.mustChangePassword,
  updatedAt: user.updatedAt,
  createdAt: user.createdAt,
}

/** `user.role` may hold several comma-separated roles (Better Auth); ours only ever set one. */
const isAdminRole = sql`(',' || coalesce(${user.role}, '') || ',') like '%,admin,%'`
const hasMembership = (branchId?: string, role?: BranchRoleName) => exists(
  sql`(select 1 from ${member} where ${member.userId} = ${user.id}${branchId ? sql` and ${member.organizationId} = ${branchId}` : sql``}${role ? sql` and ${member.role} = ${role}` : sql``})`,
)

export async function findAccount(db: Db, userId: string): Promise<AccountRow | undefined> {
  const rows: AccountRow[] = await db.select(accountColumns).from(user).where(eq(user.id, userId)).limit(1)
  return rows[0]
}

export async function findAccountByEmail(db: Db, email: string): Promise<AccountRow | undefined> {
  const rows: AccountRow[] = await db.select(accountColumns).from(user).where(eq(user.email, email)).limit(1)
  return rows[0]
}

export async function membershipsOf(db: Db, userIds: string[]): Promise<MembershipRow[]> {
  if (!userIds.length) return []
  return readInChunks(userIds, ids => db
    .select({ userId: member.userId, branchId: member.organizationId, branchName: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(inArray(member.userId, ids))
    .orderBy(asc(organization.name)))
}

/** Of these branch ids, the ones that exist and are active. */
export async function activeBranchIds(db: Db, branchIds: string[]): Promise<Set<string>> {
  if (!branchIds.length) return new Set()
  const rows: { id: string }[] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(and(inArray(organization.id, branchIds), eq(organization.status, 'active')))
  return new Set(rows.map(r => r.id))
}

/** Accounts with access (platform admin or any membership), filtered and paginated. */
export async function listStaff(db: Db, query: StaffListQuery): Promise<{ rows: AccountRow[], total: number }> {
  const conditions: SQL[] = [or(isAdminRole, hasMembership())!]
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, c => `\\${c}`)}%`
    conditions.push(or(sql`${user.name} like ${pattern} escape '\\'`, sql`${user.email} like ${pattern} escape '\\'`)!)
  }
  if (query.role === 'admin') {
    conditions.push(isAdminRole)
    if (query.branchId) conditions.push(hasMembership(query.branchId))
  }
  else if (query.role || query.branchId) {
    conditions.push(hasMembership(query.branchId, query.role))
  }
  const where = and(...conditions)

  const [totals, rows] = await Promise.all([
    db.select({ total: count() }).from(user).where(where) as Promise<{ total: number }[]>,
    db.select(accountColumns).from(user).where(where)
      .orderBy(asc(user.name), asc(user.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize) as Promise<AccountRow[]>,
  ])
  return { rows, total: totals[0]?.total ?? 0 }
}

// --- Writes: statements for the service's batch ---

export function insertAccountStatements(db: Db, row: { id: string, name: string, email: string, admin: boolean, passwordHash: string, now: Date }): Statement[] {
  return [
    db.insert(user).values({
      id: row.id,
      name: row.name,
      email: row.email,
      // The admin vouches for the address (security.md → Staff onboarding).
      emailVerified: true,
      role: row.admin ? 'admin' : 'customer',
      mustChangePassword: true,
      createdAt: row.now,
      updatedAt: row.now,
    }),
    // The shape Better Auth's email + password sign-in reads ("credential" provider).
    db.insert(account).values({
      id: newId(),
      accountId: row.id,
      providerId: 'credential',
      userId: row.id,
      password: row.passwordHash,
      createdAt: row.now,
      updatedAt: row.now,
    }),
  ]
}

/**
 * Sets the platform role, only if the account is still at the version read. Follow it with
 * `requireOneChange`.
 */
export function setPlatformRoleStatement(db: Db, userId: string, admin: boolean, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ role: admin ? 'admin' : 'customer', updatedAt: next })
    .where(and(eq(user.id, userId), eq(user.updatedAt, expected)))
}

export function replaceMembershipsStatements(db: Db, userId: string, memberships: { branchId: string, role: BranchRoleName }[], now: Date): Statement[] {
  const statements: Statement[] = [db.delete(member).where(eq(member.userId, userId))]
  for (const piece of insertPieces(member, memberships)) {
    statements.push(db.insert(member).values(piece.map(m => ({
      id: newId(),
      organizationId: m.branchId,
      userId,
      role: m.role,
      createdAt: now,
    }))))
  }
  return statements
}

/**
 * Asks for a new password at the next sign-in, only if the account is still at the version read.
 * Follow it with `requireOneChange`.
 */
export function requirePasswordChangeStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ mustChangePassword: true, updatedAt: next })
    .where(and(eq(user.id, userId), eq(user.updatedAt, expected)))
}

/** Whether the account signs in with an email and password (Better Auth's "credential" provider). */
export async function hasPasswordAccount(db: Db, userId: string): Promise<boolean> {
  const rows = await db.select({ id: account.id }).from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential'))).limit(1)
  return rows.length > 0
}

/** Replaces the password, or adds one to an account that had none. */
export function setPasswordStatement(db: Db, userId: string, passwordHash: string, now: Date, exists: boolean): Statement {
  if (exists) {
    return db.update(account)
      .set({ password: passwordHash, updatedAt: now })
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
  }
  return db.insert(account).values({ id: newId(), accountId: userId, providerId: 'credential', userId, password: passwordHash, createdAt: now, updatedAt: now })
}

/** Signs the account out everywhere: Better Auth reads sessions from this table on every request. */
export function deleteSessionsStatement(db: Db, userId: string): Statement {
  return db.delete(session).where(eq(session.userId, userId))
}

/** Aborts the batch if it would leave no admin who can sign in. */
export function requireAnAdminStatement(db: Db): Statement {
  return requireCount(db, sql`select count(*) > 0 from ${user} where ${isAdminRole} and coalesce(${user.banned}, 0) = 0`, 1)
}

export async function countAdmins(db: Db): Promise<number> {
  const rows: { total: number }[] = await db.select({ total: count() }).from(user)
    .where(and(isAdminRole, sql`coalesce(${user.banned}, 0) = 0`))
  return rows[0]?.total ?? 0
}
