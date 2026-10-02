import { and, asc, count, eq, exists, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { BranchRoleName, StaffListQuery } from '#shared/contracts/staff'
import type { Db, Statement } from '#server/utils/batch'
import { insertPieces, readInChunks, requireCount } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { account, branches, branchStaff, member, organization, session, user } from '#server/db/tables'

/**
 * Staff queries (D49, D134): a tenant's staff are its members (Better Auth's `member`, `owner` or
 * `member`) and their branches (`branch_staff`). Staff management writes these tables directly so
 * that an account, its memberships, its sessions and the audit row change in **one batch** (D1 has
 * no transactions). Better Auth reads them per request, so changes apply at once. Every query here
 * is scoped to one tenant.
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

const memberOf = (tenantId: string, role?: 'owner') => exists(
  sql`(select 1 from ${member} where ${member.userId} = ${user.id} and ${member.organizationId} = ${tenantId}${role ? sql` and ${member.role} = ${role}` : sql``})`,
)
const worksAt = (tenantId: string, branchId?: string, role?: BranchRoleName) => exists(
  sql`(select 1 from ${branchStaff} where ${branchStaff.userId} = ${user.id} and ${branchStaff.tenantId} = ${tenantId}${branchId ? sql` and ${branchStaff.branchId} = ${branchId}` : sql``}${role ? sql` and ${branchStaff.role} = ${role}` : sql``})`,
)

export async function findAccount(db: Db, userId: string): Promise<AccountRow | undefined> {
  const rows: AccountRow[] = await db.select(accountColumns).from(user).where(eq(user.id, userId)).limit(1)
  return rows[0]
}

export async function findAccountByEmail(db: Db, email: string): Promise<AccountRow | undefined> {
  const rows: AccountRow[] = await db.select(accountColumns).from(user).where(eq(user.email, email)).limit(1)
  return rows[0]
}

/** The account's role in the tenant (`owner`, `member`), `undefined` when not a member. */
export async function tenantRoleOf(db: Db, tenantId: string, userId: string): Promise<string | undefined> {
  const rows = await db.select({ role: member.role }).from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId))).limit(1)
  return rows[0]?.role
}

/** The owners among these accounts, in the tenant. */
export async function ownersAmong(db: Db, tenantId: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set()
  const rows: { userId: string }[] = await readInChunks(userIds, ids => db.select({ userId: member.userId }).from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.role, 'owner'), inArray(member.userId, ids))))
  return new Set(rows.map(r => r.userId))
}

/** Whether the account belongs to any other tenant (staff, owner) or can manage the platform. */
export async function hasAccessElsewhere(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const rows = await db.select({ id: member.id }).from(member)
    .where(and(eq(member.userId, userId), sql`${member.organizationId} <> ${tenantId}`)).limit(1)
  return rows.length > 0
}

export async function membershipsOf(db: Db, tenantId: string, userIds: string[]): Promise<MembershipRow[]> {
  if (!userIds.length) return []
  return readInChunks(userIds, ids => db
    .select({ userId: branchStaff.userId, branchId: branchStaff.branchId, branchName: branches.name, role: branchStaff.role })
    .from(branchStaff)
    .innerJoin(branches, eq(branches.id, branchStaff.branchId))
    .where(and(eq(branchStaff.tenantId, tenantId), inArray(branchStaff.userId, ids)))
    .orderBy(asc(branches.name)))
}

/** Of these branch ids, the tenant's that exist and are active. */
export async function activeBranchIds(db: Db, tenantId: string, branchIds: string[]): Promise<Set<string>> {
  if (!branchIds.length) return new Set()
  const rows: { id: string }[] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), inArray(branches.id, branchIds), eq(branches.status, 'active')))
  return new Set(rows.map(r => r.id))
}

/** The tenant's members, filtered and paginated. */
export async function listStaff(db: Db, tenantId: string, query: StaffListQuery): Promise<{ rows: AccountRow[], total: number }> {
  const conditions: SQL[] = [memberOf(tenantId)]
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, c => `\\${c}`)}%`
    conditions.push(or(sql`${user.name} like ${pattern} escape '\\'`, sql`${user.email} like ${pattern} escape '\\'`)!)
  }
  if (query.role === 'admin') {
    conditions.push(memberOf(tenantId, 'owner'))
    if (query.branchId) conditions.push(worksAt(tenantId, query.branchId))
  }
  else if (query.role || query.branchId) {
    conditions.push(worksAt(tenantId, query.branchId, query.role))
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

export function insertAccountStatements(db: Db, row: { id: string, name: string, email: string, passwordHash: string, now: Date }): Statement[] {
  return [
    db.insert(user).values({
      id: row.id,
      name: row.name,
      email: row.email,
      // The admin vouches for the address (security.md → Staff onboarding).
      emailVerified: true,
      // Access lives in the tenant's memberships, not the platform role (D134).
      role: 'customer',
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
 * Moves the account's version (`updated_at`), only if it's still the one read: every change to
 * someone's access does, so two admins editing the same person can't overwrite each other. Follow
 * it with `requireOneChange`.
 */
export function bumpVersionStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ updatedAt: next })
    .where(and(eq(user.id, userId), eq(user.updatedAt, expected)))
}

/**
 * Replaces the account's access in the tenant: its membership (`owner` or `member`; none when
 * `role` is null) and the branches it works at. Other tenants' access stays.
 */
export function replaceAccessStatements(db: Db, tenantId: string, userId: string, role: 'owner' | 'member' | null, memberships: { branchId: string, role: BranchRoleName }[], now: Date): Statement[] {
  const statements: Statement[] = [
    db.delete(branchStaff).where(and(eq(branchStaff.tenantId, tenantId), eq(branchStaff.userId, userId))),
    db.delete(member).where(and(eq(member.organizationId, tenantId), eq(member.userId, userId))),
  ]
  if (role) statements.push(db.insert(member).values({ id: newId(), organizationId: tenantId, userId, role, createdAt: now }))
  for (const piece of insertPieces(branchStaff, memberships)) {
    statements.push(db.insert(branchStaff).values(piece.map(m => ({ tenantId, branchId: m.branchId, userId, role: m.role, createdAt: now }))))
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

const activeOwners = (tenantId: string) => sql`select count(*) from ${member} join ${user} on ${user.id} = ${member.userId} where ${member.organizationId} = ${tenantId} and ${member.role} = 'owner' and coalesce(${user.banned}, 0) = 0`

/** Aborts the batch if it would leave the tenant without an owner who can sign in. */
export function requireAnOwnerStatement(db: Db, tenantId: string): Statement {
  return requireCount(db, sql`select (${activeOwners(tenantId)}) > 0`, 1)
}

export async function countOwners(db: Db, tenantId: string): Promise<number> {
  const rows: { total: number }[] = await db.select({ total: count() }).from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, tenantId), eq(member.role, 'owner'), sql`coalesce(${user.banned}, 0) = 0`))
  return rows[0]?.total ?? 0
}

/** A tenant for the seed task (D134): an organization, when none exists. */
export async function findAnyTenant(db: Db): Promise<{ id: string, name: string, slug: string } | undefined> {
  const rows = await db.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization).orderBy(asc(organization.createdAt)).limit(1)
  return rows[0]
}

export function insertTenantStatement(db: Db, row: { id: string, name: string, slug: string, now: Date }): Statement {
  return db.insert(organization).values({ id: row.id, name: row.name, slug: row.slug, status: 'active', version: 1, createdAt: row.now })
}
