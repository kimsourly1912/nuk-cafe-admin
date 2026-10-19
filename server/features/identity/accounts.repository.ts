import { and, count, desc, eq, gt, inArray, max, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AccountListQuery } from '#shared/contracts/accounts'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks } from '#server/utils/batch'
import { containsText } from '#server/utils/search'
import { member, organization, session, user } from '#server/db/tables'

/**
 * Account queries for the platform console (step P1, D187). The platform owns accounts, not any
 * cafe's data: these read `user`, its sessions and its memberships, never orders or customer
 * profiles. Writes return statements for the service's batch, each guarded by the version read.
 */

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

const columns = {
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

/** A registered account: guests (Better Auth's anonymous plugin) are the cafes' customers' carts, not people to manage. */
const registered = sql`coalesce(${user.isAnonymous}, 0) = 0`
/** `role` can hold several roles, comma-separated (Better Auth's format). */
const superadmin = sql`instr(',' || replace(coalesce(${user.role}, ''), ' ', '') || ',', ',superadmin,') > 0`
const notSuperadmin = sql`not (${superadmin})`
const isBanned = sql`coalesce(${user.banned}, 0) = 1`
const withRole = (role: 'owner' | 'member') => sql`${user.id} in (select ${member.userId} from ${member} where ${member.role} = ${role})`
const withAnyMembership = sql`${user.id} in (select ${member.userId} from ${member})`

function kindCondition(kind: AccountListQuery['kind']): SQL | undefined {
  switch (kind) {
    case 'owner': return withRole('owner')
    case 'staff': return withRole('member')
    case 'customer': return and(sql`not (${withAnyMembership})`, notSuperadmin)
    case 'superadmin': return superadmin
    case 'banned': return isBanned
    default: return undefined
  }
}

/** Registered accounts, newest first, filtered and paginated. A search scans `user` with `instr` (D183). */
export async function listAccounts(db: Db, query: AccountListQuery): Promise<{ rows: PlatformAccountRow[], total: number }> {
  const conditions: (SQL | undefined)[] = [registered, kindCondition(query.kind)]
  if (query.search) conditions.push(or(containsText(user.name, query.search), containsText(user.email, query.search)))
  const where = and(...conditions)
  const [totals, rows] = await Promise.all([
    db.select({ total: count() }).from(user).where(where) as Promise<{ total: number }[]>,
    db.select(columns).from(user).where(where)
      .orderBy(desc(user.createdAt), desc(user.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize) as Promise<PlatformAccountRow[]>,
  ])
  return { rows, total: totals[0]?.total ?? 0 }
}

/** One registered account; `undefined` for a guest or an unknown id. */
export async function findRegisteredAccount(db: Db, userId: string): Promise<PlatformAccountRow | undefined> {
  const rows: PlatformAccountRow[] = await db.select(columns).from(user).where(and(eq(user.id, userId), registered)).limit(1)
  return rows[0]
}

export interface CafeMembershipRow {
  userId: string
  tenantId: string
  name: string
  slug: string
  role: string
}

/** The cafes these accounts are members of (owners and staff: branch staff are members too), by cafe name. */
export async function cafeMemberships(db: Db, userIds: string[]): Promise<CafeMembershipRow[]> {
  if (!userIds.length) return []
  return readInChunks(userIds, ids => db
    .select({ userId: member.userId, tenantId: organization.id, name: organization.name, slug: organization.slug, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(inArray(member.userId, ids))
    .orderBy(sql`${organization.name} collate nocase`, organization.id))
}

/** Owners able to sign in (not banned) per cafe. */
export async function activeOwnerCounts(db: Db, tenantIds: string[]): Promise<Map<string, number>> {
  if (!tenantIds.length) return new Map()
  const rows: { tenantId: string, total: number }[] = await readInChunks(tenantIds, ids => db
    .select({ tenantId: member.organizationId, total: count() })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(inArray(member.organizationId, ids), eq(member.role, 'owner'), sql`coalesce(${user.banned}, 0) = 0`))
    .groupBy(member.organizationId))
  return new Map(rows.map(row => [row.tenantId, row.total]))
}

/** Sessions not expired yet, and the latest activity among them. */
export async function openSessions(db: Db, userId: string, now: Date): Promise<{ total: number, lastActiveAt: Date | null }> {
  const rows: { total: number, lastActiveAt: Date | null }[] = await db
    .select({ total: count(), lastActiveAt: max(session.updatedAt) })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
  return { total: rows[0]?.total ?? 0, lastActiveAt: rows[0]?.lastActiveAt ?? null }
}

// --- Writes: statements for the service's batch ---

/**
 * Only if the account is still at the version read, still registered and not a super admin: a role
 * granted meanwhile must not be missed. Follow each with `requireOneChange`.
 */
const changeable = (userId: string, expected: Date) =>
  and(eq(user.id, userId), eq(user.updatedAt, expected), registered, notSuperadmin)

export function banStatement(db: Db, userId: string, expected: Date, next: Date, ban: { reason: string, until: Date | null }): Statement {
  return db.update(user)
    .set({ banned: true, banReason: ban.reason, banExpires: ban.until, updatedAt: next })
    .where(and(changeable(userId, expected), sql`coalesce(${user.banned}, 0) = 0`))
}

export function unbanStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ banned: false, banReason: null, banExpires: null, updatedAt: next })
    .where(and(eq(user.id, userId), eq(user.updatedAt, expected), registered, isBanned))
}

/** The account's version moves and it must choose a new password; the password itself is another statement. */
export function temporaryPasswordStatement(db: Db, userId: string, expected: Date, next: Date): Statement {
  return db.update(user)
    .set({ mustChangePassword: true, updatedAt: next })
    .where(and(changeable(userId, expected), sql`coalesce(${user.banned}, 0) = 0`))
}

/** Registered accounts banned now (the console's Overview, D191). */
export async function countBanned(db: Db): Promise<number> {
  const rows: { total: number }[] = await db.select({ total: count() }).from(user).where(and(registered, isBanned))
  return rows[0]?.total ?? 0
}

/** These accounts' names and emails, guests included (an audit row may name any account). */
export async function identities(db: Db, userIds: string[]): Promise<{ id: string, name: string, email: string }[]> {
  if (!userIds.length) return []
  return readInChunks(userIds, ids => db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(inArray(user.id, ids)))
}
