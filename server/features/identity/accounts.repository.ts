import { and, asc, count, desc, eq, gt, inArray, max, not, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AccountListQuery } from '#shared/contracts/accounts'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks } from '#server/utils/batch'
import { byName, firstRow, readPage, searchIn } from '#server/utils/query'
import { member, organization, session, user } from '#server/db/tables'
import { accountCanSignIn, ownerCanSignIn, registeredAccount } from './identity.repository'

// --- Row types ---

export interface PlatformAccountRow {
  id: string
  name: string
  email: string
  emailVerified: boolean | null
  role: string | null
  banned: boolean | null
  banReason: string | null
  banExpires: Date | null
  mustChangePassword: boolean | null
  isAnonymous: boolean | null
  createdAt: Date
  updatedAt: Date
}

export interface CafeMembershipRow {
  userId: string
  tenantId: string
  name: string
  slug: string
  role: string
}

// --- Column lists and conditions ---

const accountColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  role: user.role,
  banned: user.banned,
  banReason: user.banReason,
  banExpires: user.banExpires,
  mustChangePassword: user.mustChangePassword,
  isAnonymous: user.isAnonymous,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
}

/** `role` can hold several roles, comma-separated (Better Auth's format). */
const superadmin = sql`instr(',' || replace(coalesce(${user.role}, ''), ' ', '') || ',', ',superadmin,') > 0`

const notSuperadmin = not(superadmin)

const isBanned = eq(user.banned, true)

const withRole = (db: Db, role: 'owner' | 'member') => inArray(user.id, db.select({ id: member.userId }).from(member).where(eq(member.role, role)))

const withAnyMembership = (db: Db) => inArray(user.id, db.select({ id: member.userId }).from(member))

/**
 * Only if the account is still at the version read, still registered and not a super admin: a role
 * granted meanwhile must not be missed. Follow each with `requireOneChange`.
 */
const changeable = (userId: string, expected: Date) =>
  and(
    eq(user.id, userId),
    eq(user.updatedAt, expected),
    registeredAccount,
    notSuperadmin,
  )

// --- Reads ---

function kindCondition(db: Db, kind: AccountListQuery['kind']): SQL | undefined {
  switch (kind) {
    case 'owner': return withRole(db, 'owner')
    case 'staff': return withRole(db, 'member')
    case 'customer': return and(not(withAnyMembership(db)), notSuperadmin)
    case 'superadmin': return superadmin
    case 'banned': return isBanned
    default: return undefined
  }
}

/** Registered accounts, newest first, filtered and paginated. A search scans `user` with `instr` (D183). */
export async function listAccounts(db: Db, query: AccountListQuery): Promise<{ rows: PlatformAccountRow[], total: number }> {
  const where = and(
    registeredAccount,
    kindCondition(db, query.kind),
    searchIn(query.search, user.name, user.email),
  )
  return readPage(db,
    db.select(accountColumns).from(user).where(where).orderBy(desc(user.createdAt), desc(user.id)).$dynamic(),
    db.select({ total: count() }).from(user).where(where), query)
}

/** One registered account; `undefined` for a guest or an unknown id. */
export async function findRegisteredAccount(db: Db, userId: string): Promise<PlatformAccountRow | undefined> {
  return firstRow(db.select(accountColumns).from(user).where(and(eq(user.id, userId), registeredAccount)))
}

/** Across cafes: the cafes these accounts are members of (owners and staff: branch staff are members too), by cafe name. */
export async function membershipsOf(db: Db, userIds: string[]): Promise<CafeMembershipRow[]> {
  return readInChunks(userIds, ids => db
    .select({ userId: member.userId, tenantId: organization.id, name: organization.name, slug: organization.slug, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(inArray(member.userId, ids))
    .orderBy(byName(organization.name), asc(organization.id)))
}

/** Across cafes: owners able to sign in (not banned) per cafe. */
export async function activeOwnerCounts(db: Db, tenantIds: string[]): Promise<Map<string, number>> {
  const rows = await readInChunks(tenantIds, ids => db
    .select({ tenantId: member.organizationId, total: count() })
    .from(member)
    .where(and(inArray(member.organizationId, ids), ownerCanSignIn(db)))
    .groupBy(member.organizationId))
  return new Map(rows.map(row => [row.tenantId, row.total]))
}

/** Sessions not expired yet, and the latest activity among them. */
export async function currentSessions(db: Db, userId: string, now: Date): Promise<{ total: number, lastActiveAt: Date | null }> {
  const rows = await db
    .select({ total: count(), lastActiveAt: max(session.updatedAt) })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
  return { total: rows[0]?.total ?? 0, lastActiveAt: rows[0]?.lastActiveAt ?? null }
}

/** Registered accounts banned now (the console's Overview, D191). */
export async function countBanned(db: Db): Promise<number> {
  const rows = await db.select({ total: count() }).from(user).where(and(registeredAccount, isBanned))
  return rows[0]?.total ?? 0
}

/** These accounts' names and emails, guests included (an audit row may name any account). */
export async function findAccountIdentities(db: Db, userIds: string[]): Promise<{ id: string, name: string, email: string }[]> {
  return readInChunks(userIds, ids => db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, ids)))
}

// --- Write statements ---

/** Bans a changeable, unbanned account at the version read. Follow it with `requireOneChange`. */
export function banAccountStatement(db: Db, userId: string, expected: Date, next: Date, ban: { reason: string, until: Date | null }): Statement {
  return db.update(user)
    .set({ banned: true, banReason: ban.reason, banExpires: ban.until, updatedAt: next })
    .where(and(changeable(userId, expected), accountCanSignIn))
}

/** Unbans a registered, banned account at the version read. Follow it with `requireOneChange`. */
export function unbanAccountStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ banned: false, banReason: null, banExpires: null, updatedAt: next })
    .where(and(
      eq(user.id, userId),
      eq(user.updatedAt, expected),
      registeredAccount,
      isBanned,
    ))
}

/** Moves the changeable account's version and asks for a new password. Follow it with `requireOneChange`; the password is another statement. */
export function updateTemporaryPasswordStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ mustChangePassword: true, updatedAt: next })
    .where(and(changeable(userId, expected), accountCanSignIn))
}
