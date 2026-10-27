import { and, asc, count, eq, exists, inArray, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { BranchRoleName, StaffListQuery } from '#shared/contracts/staff'
import type { Db, Statement } from '#server/utils/batch'
import { insertAll, readInChunks, requireCount } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { byName, firstRow, hasAny, inTenant, readPage, searchIn } from '#server/utils/query'
import { activeBranch } from '#server/features/branches'
import { account, branches, branchStaff, member, session, user } from '#server/db/tables'
import { accountCanSignIn, ownerCanSignIn, registeredAccount } from './identity.repository'

// --- Row types ---

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

export interface OwnerRow {
  id: string
  name: string
  email: string
  banned: boolean
  /** Works at one of the tenant's branches too: removing the ownership keeps that (P2, D189). */
  staffAccess: boolean
}

export interface AccountIdentity {
  id: string
  name: string
  email: string
}

// --- Column lists and conditions ---

const accountColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  mustChangePassword: user.mustChangePassword,
  updatedAt: user.updatedAt,
  createdAt: user.createdAt,
}

// The staff list starts from the tenant's own rows (`member_organizationId_idx`, the `branch_staff`
// primary key) and then looks users up by primary key. `user` holds every customer and guest of every
// cafe, so a check per user (a correlated `exists`) scanned all of them. `in (select …)` is a
// semi-join: a person with several membership or branch rows still matches once.
const memberIds = (db: Db, tenantId: string, role?: 'owner') =>
  inArray(user.id, db.select({ userId: member.userId }).from(member).where(and(
    eq(member.organizationId, tenantId),
    role ? eq(member.role, role) : undefined,
  )))

// `branch_staff` is indexed by branch and by user, not by tenant: without a branch, the tenant's rows
// are reached through its branches (`branches_tenant_id_unique`, archived ones too) instead of
// scanning every cafe's staff. A row's branch always belongs to its tenant (composite key).
const workerIds = (db: Db, tenantId: string, branchId?: string, role?: BranchRoleName) =>
  inArray(user.id, db.select({ userId: branchStaff.userId }).from(branchStaff).where(inTenant(branchStaff, tenantId,
    branchId ? eq(branchStaff.branchId, branchId) : inArray(branchStaff.branchId, db.select({ id: branches.id }).from(branches).where(inTenant(branches, tenantId))),
    role ? eq(branchStaff.role, role) : undefined,
  )))

/**
 * An account a cafe can be given to (D185): registered (not a guest, `is_anonymous`) and not
 * disabled. A super admin counts: the new-person path always allowed one.
 */
const eligibleAccount = and(accountCanSignIn, registeredAccount)

// --- Reads ---

export async function findAccount(db: Db, userId: string): Promise<AccountRow | undefined> {
  return firstRow(db.select(accountColumns).from(user).where(eq(user.id, userId)))
}

export async function findAccountByEmail(db: Db, email: string): Promise<AccountRow | undefined> {
  return firstRow(db.select(accountColumns).from(user).where(eq(user.email, email)))
}

/** The owners among these accounts, in the tenant. */
export async function ownersAmong(db: Db, tenantId: string, userIds: string[]): Promise<Set<string>> {
  const rows = await readInChunks(userIds, ids => db.select({ userId: member.userId }).from(member)
    .where(and(
      eq(member.organizationId, tenantId),
      eq(member.role, 'owner'),
      inArray(member.userId, ids),
    )))
  return new Set(rows.map(r => r.userId))
}

/** Across cafes: whether the account belongs to another cafe (staff or owner). */
export async function hasAccessElsewhere(db: Db, tenantId: string, userId: string): Promise<boolean> {
  return hasAny(db, member, and(eq(member.userId, userId), ne(member.organizationId, tenantId)))
}

export async function membershipsOf(db: Db, tenantId: string, userIds: string[]): Promise<MembershipRow[]> {
  return readInChunks(userIds, ids => db
    .select({ userId: branchStaff.userId, branchId: branchStaff.branchId, branchName: branches.name, role: branchStaff.role })
    .from(branchStaff)
    .innerJoin(branches, and(eq(branches.tenantId, branchStaff.tenantId), eq(branches.id, branchStaff.branchId)))
    .where(inTenant(branchStaff, tenantId, inArray(branchStaff.userId, ids)))
    .orderBy(asc(branches.name), asc(branches.id), asc(branchStaff.userId)))
}

/** Of these branch ids, the tenant's that exist and are active. */
export async function activeBranchIds(db: Db, tenantId: string, branchIds: string[]): Promise<Set<string>> {
  const rows = await readInChunks(branchIds, ids => db.select({ id: branches.id }).from(branches)
    .where(inTenant(branches, tenantId, inArray(branches.id, ids), activeBranch)))
  return new Set(rows.map(r => r.id))
}

/** The cafe's members, filtered and paginated. Uses member_organizationId_idx and branch_staff's primary key. */
export async function listStaff(db: Db, tenantId: string, query: StaffListQuery): Promise<{ rows: AccountRow[], total: number }> {
  // Owners are members, so the owner filter stands in for the membership one.
  const conditions: SQL[] = [memberIds(db, tenantId, query.role === 'admin' ? 'owner' : undefined)]
  const search = searchIn(query.search, user.name, user.email)
  if (search) conditions.push(search)
  if (query.role === 'admin') {
    if (query.branchId) conditions.push(workerIds(db, tenantId, query.branchId))
  }
  else if (query.role || query.branchId) {
    conditions.push(workerIds(db, tenantId, query.branchId, query.role))
  }
  const where = and(...conditions)

  return readPage(db,
    db.select(accountColumns).from(user).where(where).orderBy(asc(user.name), asc(user.id)).$dynamic(),
    db.select({ total: count() }).from(user).where(where), query)
}

/** Whether the account signs in with an email and password (Better Auth's "credential" provider). */
export async function hasPasswordAccount(db: Db, userId: string): Promise<boolean> {
  return hasAny(db, account, and(eq(account.userId, userId), eq(account.providerId, 'credential')))
}

export async function countOwners(db: Db, tenantId: string): Promise<number> {
  return db.$count(member, and(eq(member.organizationId, tenantId), ownerCanSignIn(db)))
}

/** Across cafes: people with access per tenant (owners and branch staff are all members), for the platform console (D142). */
export async function memberCounts(db: Db, tenantIds: string[]): Promise<{ tenantId: string, total: number }[]> {
  return readInChunks(tenantIds, ids => db.select({ tenantId: member.organizationId, total: count() }).from(member)
    .where(inArray(member.organizationId, ids))
    .groupBy(member.organizationId))
}

/** A tenant's owners, by name (the platform console's cafe details, D142, D189). */
export async function ownersOf(db: Db, tenantId: string): Promise<OwnerRow[]> {
  const rows = await db.select({
    id: user.id,
    name: user.name,
    email: user.email,
    banned: sql<number>`coalesce(${user.banned}, 0)`,
    staffAccess: exists(db.select({ userId: branchStaff.userId }).from(branchStaff).where(inTenant(branchStaff, tenantId, eq(branchStaff.userId, user.id)))),
  }).from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, tenantId), eq(member.role, 'owner')))
    .orderBy(asc(user.name), asc(user.email), asc(user.id))
  return rows.map(row => ({ ...row, banned: Boolean(row.banned), staffAccess: Boolean(row.staffAccess) }))
}

/** Whether the account works at one of the tenant's branches. */
export async function hasBranchRole(db: Db, tenantId: string, userId: string): Promise<boolean> {
  return hasAny(db, branchStaff, inTenant(branchStaff, tenantId, eq(branchStaff.userId, userId)))
}

export async function findEligibleAccount(db: Db, userId: string): Promise<AccountIdentity | undefined> {
  return firstRow(db.select({ id: user.id, name: user.name, email: user.email }).from(user)
    .where(and(eq(user.id, userId), eligibleAccount)))
}

/** Eligible accounts whose name or email contains `search`, by name, at most `limit`: a bounded lookup, never the whole user table. */
export async function searchEligibleAccounts(db: Db, search: string, limit: number): Promise<AccountIdentity[]> {
  return db.select({ id: user.id, name: user.name, email: user.email }).from(user)
    .where(and(eligibleAccount, searchIn(search, user.name, user.email)))
    .orderBy(byName(user.name), asc(user.email), asc(user.id))
    .limit(limit)
}

/** Across cafes: the cafes these accounts own: a row per cafe. */
export async function ownedTenants(db: Db, userIds: string[]): Promise<{ userId: string, tenantId: string }[]> {
  return readInChunks(userIds, ids => db.select({ userId: member.userId, tenantId: member.organizationId }).from(member)
    .where(and(eq(member.role, 'owner'), inArray(member.userId, ids))))
}

// --- Guards ---

/** Aborts the batch if it would leave the tenant without an owner who can sign in. */
export function requireAnOwner(db: Db, tenantId: string): Statement {
  return requireCount(db, sql`${db.$count(member, and(eq(member.organizationId, tenantId), ownerCanSignIn(db)))} > 0`, 1)
}

/** Aborts the batch unless the account is still eligible: disabling it meanwhile must not be missed. */
export function requireEligibleAccount(db: Db, userId: string): Statement {
  return requireCount(db, db.$count(user, and(eq(user.id, userId), eligibleAccount)), 1)
}

// --- Write statements ---

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
export function touchAccountStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
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
    db.delete(branchStaff).where(inTenant(branchStaff, tenantId, eq(branchStaff.userId, userId))),
    db.delete(member).where(and(eq(member.organizationId, tenantId), eq(member.userId, userId))),
  ]
  if (role) statements.push(db.insert(member).values({ id: newId(), organizationId: tenantId, userId, role, createdAt: now }))
  statements.push(...insertAll(db, branchStaff, memberships.map(m => ({ tenantId, branchId: m.branchId, userId, role: m.role, createdAt: now }))))
  return statements
}

/**
 * Asks for a new password at the next sign-in, only if the account is still at the version read.
 * Follow it with `requireOneChange`.
 */
export function updatePasswordRequirementStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ mustChangePassword: true, updatedAt: next })
    .where(and(eq(user.id, userId), eq(user.updatedAt, expected)))
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

/**
 * Replaces the account's role in the tenant (`owner`, `member`, none when `null`), keeping the
 * branches it works at: the platform's ownership changes (P2, D189) never touch branch roles.
 */
export function setTenantRoleStatements(db: Db, tenantId: string, userId: string, role: 'owner' | 'member' | null, now: Date): Statement[] {
  const statements: Statement[] = [db.delete(member).where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))]
  if (role) statements.push(db.insert(member).values({ id: newId(), organizationId: tenantId, userId, role, createdAt: now }))
  return statements
}
