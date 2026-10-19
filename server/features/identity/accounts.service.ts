import { hashPassword } from 'better-auth/crypto'
import type { AccountBan, AccountListQuery, AccountPasswordInput, AccountTemporaryPassword, BanAccountInput, PlatformAccountDetail, PlatformAccountSummary, UnbanAccountInput } from '#shared/contracts/accounts'
import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { Db, Statement } from '#server/utils/batch'
import { runBatch, requireOneChange } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import { auditStatement } from '#server/features/platform'
import { accountBanned, accountChanged, accountNotFound, alreadyBanned, banEndInPast, notBanned, ownAccount, platformAccount } from './accounts.errors'
import * as repo from './accounts.repository'
import type { CafeMembershipRow, PlatformAccountRow } from './accounts.repository'
import * as staffRepo from './staff.repository'
import { generateTemporaryPassword, isSuperadmin, nextVersion } from './staff.rules'

/**
 * The platform console's Accounts (step P1, D186, D187). A super admin manages **accounts**: who can
 * sign in, their sessions and their password; never a cafe's data. Every change is one batch with
 * its guards (the version read, still registered, not a super admin) and an audit row in the
 * platform's own history (`tenant_id` null). Super admins' accounts and one's own are never changed
 * here: another super admin is set by hand, one's own through the account menu.
 */

/** The super admin acting (`requirePlatformPermission`). */
export interface PlatformAccountActor {
  userId: string
  requestId?: string
}

const audit = (db: Db, actor: PlatformAccountActor, action: string, userId: string, metadata: Record<string, unknown> = {}) =>
  auditStatement(db, { userId: actor.userId, tenantId: null, requestId: actor.requestId }, { action, targetType: 'user', targetId: userId, metadata })

function banOf(row: PlatformAccountRow): AccountBan | null {
  if (!row.banned) return null
  return { reason: row.banReason ?? null, until: row.banExpires ? toIso(row.banExpires) : null }
}

function toSummary(row: PlatformAccountRow, memberships: CafeMembershipRow[]): PlatformAccountSummary {
  const own = memberships.filter(m => m.userId === row.id)
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: Boolean(row.emailVerified),
    isSuperadmin: isSuperadmin(row.role),
    ownerOf: own.filter(m => m.role === 'owner').length,
    staffOf: own.filter(m => m.role !== 'owner').length,
    ban: banOf(row),
    createdAt: toIso(row.createdAt),
  }
}

export async function listPlatformAccounts(db: Db, query: AccountListQuery): Promise<Page<PlatformAccountSummary>> {
  const { rows, total } = await repo.listAccounts(db, query)
  const memberships = await repo.cafeMemberships(db, rows.map(row => row.id))
  return {
    items: rows.map(row => toSummary(row, memberships)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: totalPages(total, query.pageSize),
  }
}

async function loadAccount(db: Db, userId: string): Promise<PlatformAccountRow> {
  const row = await repo.findRegisteredAccount(db, userId)
  if (!row) throw accountNotFound()
  return row
}

async function toDetail(db: Db, row: PlatformAccountRow, now: Date): Promise<PlatformAccountDetail> {
  const memberships = await repo.cafeMemberships(db, [row.id])
  const owned = memberships.filter(m => m.role === 'owner').map(m => m.tenantId)
  const [activeOwners, sessions] = await Promise.all([repo.activeOwnerCounts(db, owned), repo.openSessions(db, row.id, now)])
  return {
    ...toSummary(row, memberships),
    cafes: memberships.map(m => ({
      id: m.tenantId,
      name: m.name,
      slug: m.slug,
      role: m.role === 'owner' ? 'owner' as const : 'staff' as const,
      // This account can sign in and is the only owner of the cafe who can.
      onlyActiveOwner: m.role === 'owner' && !row.banned && activeOwners.get(m.tenantId) === 1,
    })),
    mustChangePassword: Boolean(row.mustChangePassword),
    activeSessions: sessions.total,
    lastActiveAt: sessions.lastActiveAt ? toIso(sessions.lastActiveAt) : null,
    version: row.updatedAt.getTime(),
  }
}

/** One registered account, with the cafes it works in; 404 for a guest or an unknown id. */
export async function getPlatformAccount(db: Db, userId: string, now = new Date()): Promise<PlatformAccountDetail> {
  return toDetail(db, await loadAccount(db, userId), now)
}

/** An account the console may change: registered, not the caller's own, not a super admin's. */
async function loadChangeable(db: Db, actor: PlatformAccountActor, userId: string, version?: number): Promise<PlatformAccountRow> {
  if (actor.userId === userId) throw ownAccount()
  const row = await loadAccount(db, userId)
  if (isSuperadmin(row.role)) throw platformAccount()
  if (version !== undefined && row.updatedAt.getTime() !== version) throw accountChanged()
  return row
}

/**
 * Bans an account: it can't sign in anywhere (customer, admin, counter), and every session it has
 * ends in the same batch. A cafe it owns keeps running (D186): the console shows it without an
 * active owner. `until` ends the ban by itself.
 */
export async function banAccount(db: Db, actor: PlatformAccountActor, userId: string, input: BanAccountInput, now = new Date()): Promise<PlatformAccountDetail> {
  const row = await loadChangeable(db, actor, userId, input.version)
  if (row.banned) throw alreadyBanned()
  const until = input.until ? new Date(input.until) : null
  if (until && until.getTime() <= now.getTime()) throw banEndInPast()

  await runBatch(db, [
    repo.banStatement(db, userId, row.updatedAt, nextVersion(row.updatedAt, now), { reason: input.reason, until }),
    requireOneChange(db),
    staffRepo.deleteSessionsStatement(db, userId),
    audit(db, actor, 'platform.account.ban', userId, { reason: input.reason, until: until ? toIso(until) : null }),
  ], accountChanged)
  return getPlatformAccount(db, userId, now)
}

/** Lifts a ban. Any account's, a super admin's set by hand included: unbanning takes nothing away. */
export async function unbanAccount(db: Db, actor: PlatformAccountActor, userId: string, input: UnbanAccountInput, now = new Date()): Promise<PlatformAccountDetail> {
  if (actor.userId === userId) throw ownAccount()
  const row = await loadAccount(db, userId)
  if (row.updatedAt.getTime() !== input.version) throw accountChanged()
  if (!row.banned) throw notBanned()

  await runBatch(db, [
    repo.unbanStatement(db, userId, row.updatedAt, nextVersion(row.updatedAt, now)),
    requireOneChange(db),
    audit(db, actor, 'platform.account.unban', userId),
  ], accountChanged)
  return getPlatformAccount(db, userId, now)
}

/**
 * Signs an account out everywhere (a lost phone, a shared counter tablet). Nothing about the account
 * changes, so no version: running it twice ends the same sessions.
 */
export async function signOutAccount(db: Db, actor: PlatformAccountActor, userId: string, now = new Date()): Promise<PlatformAccountDetail> {
  await loadChangeable(db, actor, userId)
  const statements: Statement[] = [
    staffRepo.deleteSessionsStatement(db, userId),
    audit(db, actor, 'platform.account.sign-out', userId),
  ]
  await db.batch(statements as [Statement, ...Statement[]])
  return getPlatformAccount(db, userId, now)
}

/**
 * Gives an account a temporary password, returned once (as D115 for staff): the account must choose
 * its own at the next sign-in, and every session ends, so whoever knew the old password is out.
 * For an owner or customer who lost access while email can't be sent (Q4). Never for a banned
 * account (unban first).
 */
export async function setTemporaryPassword(db: Db, actor: PlatformAccountActor, userId: string, input: AccountPasswordInput, now = new Date()): Promise<AccountTemporaryPassword> {
  const row = await loadChangeable(db, actor, userId, input.version)
  if (row.banned) throw accountBanned()

  const temporaryPassword = generateTemporaryPassword()
  await runBatch(db, [
    repo.temporaryPasswordStatement(db, userId, row.updatedAt, nextVersion(row.updatedAt, now)),
    requireOneChange(db),
    staffRepo.setPasswordStatement(db, userId, await hashPassword(temporaryPassword), now, await staffRepo.hasPasswordAccount(db, userId)),
    staffRepo.deleteSessionsStatement(db, userId),
    audit(db, actor, 'platform.account.password.temporary', userId, { reason: input.reason }),
  ], accountChanged)
  return { account: await getPlatformAccount(db, userId, now), temporaryPassword }
}
