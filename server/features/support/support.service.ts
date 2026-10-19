import type { CafeSupport, SupportGrant, SupportOpened, SupportPerson, TenantSupport } from '#shared/contracts/support'
import { SUPPORT_GRANT_HOURS, SUPPORT_VISIT_MINUTES } from '#shared/contracts/support'
import type { AdminSession } from '#shared/contracts/identity'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import { accountIdentities, isSuperadmin, tenantById } from '#server/features/identity'
import type { Actor, SessionUser, TenantPermission } from '#server/features/identity'
import { auditStatement, listAuditEvents } from '#server/features/platform'
import { grantNotFound, invalidCode, supportAlreadyAllowed, supportNotAllowed, supportNotPermitted, supportReadOnly, tooManyCodes } from './support.errors'
import * as repo from './support.repository'
import type { GrantRow } from './support.repository'
import { CODE_WINDOW_MS, isReadRequest, isSupportReadable, MAX_CODE_FAILURES, supportPermissionList } from './support.rules'

/**
 * Support access (step P5, D193). The cafe's owner allows it for 24 hours from the admin; any super
 * admin opens a visit with a fresh two-step code; the visit reads the cafe's admin, read-only, until
 * it, or the grant, ends. Every step and every request is in the cafe's audit history. Not Better
 * Auth's `impersonateUser`: the super admin stays themselves, in one cafe, with its owner's consent.
 */

const HOUR_MS = 60 * 60_000
const OPEN_ACTION = 'tenant.support.open'
const CODE_FAILED_ACTION = 'tenant.support.code-failed'

// --- The owner's side (`/api/c/<slug>/admin/support`) ---

async function toGrants(db: Db, tenantId: string, rows: GrantRow[], now: Date): Promise<SupportGrant[]> {
  const visits = await repo.visitsOf(db, tenantId, rows.map(row => row.id))
  const people = await accountIdentities(db, [...rows.flatMap(row => [row.grantedBy, row.endedBy ?? '']), ...visits.map(visit => visit.userId)].filter(Boolean))
  const person = (id: string): SupportPerson => ({ id, name: people.get(id)?.name ?? null })
  return rows.map(row => ({
    id: row.id,
    grantedBy: person(row.grantedBy),
    grantedAt: toIso(row.grantedAt),
    expiresAt: toIso(row.expiresAt),
    endedAt: row.endedAt ? toIso(row.endedAt) : null,
    endedBy: row.endedBy ? person(row.endedBy) : null,
    active: !row.endedAt && row.expiresAt.getTime() > now.getTime(),
    visits: visits.filter(visit => visit.grantId === row.id).map(visit => ({
      id: visit.id,
      by: person(visit.userId),
      openedAt: toIso(visit.openedAt),
      expiresAt: toIso(visit.expiresAt),
      closedAt: visit.closedAt ? toIso(visit.closedAt) : null,
    })),
  }))
}

/** The grant in force and the latest ten, with who looked and when. */
export async function getCafeSupport(db: Db, tenantId: string, now = new Date()): Promise<CafeSupport> {
  const history = await toGrants(db, tenantId, await repo.latestGrants(db, tenantId, 10), now)
  return { active: history.find(grant => grant.active) ?? null, history }
}

/** Allows platform support for 24 hours. One grant at a time: a second one while it's in force is 409. */
export async function allowSupport(db: Db, actor: Actor, now = new Date()): Promise<CafeSupport> {
  const { tenantId } = actor
  if (await repo.findActiveGrant(db, tenantId, now)) throw supportAlreadyAllowed()
  const id = newId()
  const expiresAt = new Date(now.getTime() + SUPPORT_GRANT_HOURS * HOUR_MS)
  try {
    await db.batch([
      repo.requireNoActiveGrant(db, tenantId, now),
      repo.insertGrantStatement(db, { id, tenantId, grantedBy: actor.userId, grantedAt: now, expiresAt }),
      auditStatement(db, { userId: actor.userId, tenantId, requestId: actor.requestId }, { action: 'support.grant', targetType: 'support_grant', targetId: id, metadata: { expiresAt: toIso(expiresAt) } }),
    ])
  }
  catch (error) {
    // Another owner allowed it meanwhile.
    if (isStaleWrite(error)) throw supportAlreadyAllowed()
    throw error
  }
  return getCafeSupport(db, tenantId, now)
}

/** Ends the grant now, and with it every visit under it. */
export async function endSupport(db: Db, actor: Actor, grantId: string, now = new Date()): Promise<CafeSupport> {
  const { tenantId } = actor
  try {
    await db.batch([
      repo.endGrantStatement(db, tenantId, grantId, actor.userId, now),
      requireOneChange(db),
      repo.closeGrantVisitsStatement(db, tenantId, grantId, now),
      auditStatement(db, { userId: actor.userId, tenantId, requestId: actor.requestId }, { action: 'support.end', targetType: 'support_grant', targetId: grantId, metadata: {} }),
    ])
  }
  catch (error) {
    // Unknown, another cafe's, already ended or expired.
    if (isStaleWrite(error)) throw grantNotFound()
    throw error
  }
  return getCafeSupport(db, tenantId, now)
}

/** Whether the cafe's owner allows support now, for the console's cafe page. */
export async function tenantSupport(db: Db, tenantId: string, now = new Date()): Promise<TenantSupport | null> {
  const grant = await repo.findActiveGrant(db, tenantId, now)
  return grant ? { grantedAt: toIso(grant.grantedAt), expiresAt: toIso(grant.expiresAt) } : null
}

// --- The platform's side (`/api/platform/tenants/{id}/support`) ---

export interface SupportVisitor {
  userId: string
  sessionId: string
  requestId?: string
}

/**
 * Opens a visit to the cafe for this session after a fresh two-step code (`verifyCode`, Better
 * Auth's own check of the super admin's authenticator code). At most `MAX_CODE_FAILURES` wrong codes
 * per super admin in 15 minutes, each one audited: Better Auth doesn't limit a signed-in check.
 */
export async function openSupportVisit(db: Db, visitor: SupportVisitor, tenantId: string, verifyCode: () => Promise<boolean>, now = new Date()): Promise<SupportOpened> {
  const tenant = await tenantById(db, tenantId)
  if (!tenant) throw grantNotFound()
  const grant = await repo.findActiveGrant(db, tenantId, now)
  if (!grant) throw supportNotAllowed()

  const { total: failures } = await listAuditEvents(db, { actions: [CODE_FAILED_ACTION], actorId: visitor.userId, since: new Date(now.getTime() - CODE_WINDOW_MS), limit: 1, offset: 0 })
  if (failures >= MAX_CODE_FAILURES) throw tooManyCodes()
  const by = { userId: visitor.userId, tenantId, requestId: visitor.requestId }
  if (!await verifyCode()) {
    await db.batch([auditStatement(db, by, { action: CODE_FAILED_ACTION, targetType: 'support_grant', targetId: grant.id, metadata: {} })])
    throw invalidCode()
  }

  const id = newId()
  const expiresAt = new Date(Math.min(now.getTime() + SUPPORT_VISIT_MINUTES * 60_000, grant.expiresAt.getTime()))
  const statements: Statement[] = [
    repo.requireGrantActive(db, tenantId, grant.id, now),
    repo.insertVisitStatement(db, { id, tenantId, grantId: grant.id, userId: visitor.userId, sessionId: visitor.sessionId, openedAt: now, expiresAt }),
    auditStatement(db, by, { action: OPEN_ACTION, targetType: 'support_grant', targetId: grant.id, metadata: { visitId: id, expiresAt: toIso(expiresAt) } }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // The owner ended it between the check and the save.
    if (isStaleWrite(error)) throw supportNotAllowed()
    throw error
  }
  return { path: `/c/${tenant.slug}/admin`, expiresAt: toIso(expiresAt) }
}

/** Leaves the cafe: closes this session's open visits there. */
export async function closeSupportVisits(db: Db, visitor: SupportVisitor, tenantId: string, now = new Date()): Promise<void> {
  await db.batch([
    repo.closeSessionVisitsStatement(db, tenantId, visitor.sessionId, now),
    auditStatement(db, { userId: visitor.userId, tenantId, requestId: visitor.requestId }, { action: 'tenant.support.close', targetType: 'tenant', targetId: tenantId, metadata: {} }),
  ])
}

// --- A request in the cafe's admin during a visit ---

export interface SupportRequest {
  user: SessionUser | null | undefined
  sessionId: string | undefined
  tenantId: string
  method: string
  /** The path without its query (a search can name a customer). */
  path: string
  requestId?: string
}

/** A super admin able to use the console now (as `authorizePlatform`): signed in, not banned, no temporary password, two-step sign-in on. */
const canSupport = (user: SessionUser | null | undefined): user is SessionUser =>
  !!user && !user.banned && !user.mustChangePassword && !!user.twoFactorEnabled && isSuperadmin(user.role)

async function openVisitFor(db: Db, request: Pick<SupportRequest, 'user' | 'sessionId' | 'tenantId'>, now: Date) {
  if (!canSupport(request.user) || !request.sessionId) return undefined
  const visit = await repo.findOpenVisit(db, request.tenantId, request.sessionId, now)
  return visit && visit.userId === request.user.id ? visit : undefined
}

const requestAudit = (db: Db, request: SupportRequest, visit: { id: string, grantId: string }) =>
  auditStatement(db, { userId: request.user!.id, tenantId: request.tenantId, requestId: request.requestId }, {
    action: 'support.request',
    targetType: 'support_grant',
    targetId: visit.grantId,
    metadata: { visitId: visit.id, method: request.method.toUpperCase(), path: request.path },
  })

/**
 * The actor of a request made during a support visit, for `requirePermission` when the caller isn't
 * the cafe's own: `undefined` without a visit (the usual refusal stands). With one, a write is 403
 * `SUPPORT_READ_ONLY` and a read outside the support permissions 403; an allowed read is audited and
 * acts as `role: 'support'`.
 */
export async function supportActor(db: Db, request: SupportRequest, permissions: TenantPermission, now = new Date()): Promise<Actor | undefined> {
  const visit = await openVisitFor(db, request, now)
  if (!visit) return undefined
  if (!isReadRequest(request.method)) throw supportReadOnly()
  if (!isSupportReadable(permissions)) throw supportNotPermitted()
  await db.batch([requestAudit(db, request, visit)])
  return { userId: request.user!.id, tenantId: request.tenantId, role: 'support', requestId: request.requestId }
}

/** `GET /api/c/<slug>/admin/me` during a visit: who is looking, read-only, and until when. `undefined` without one. */
export async function supportSession(db: Db, request: SupportRequest, now = new Date()): Promise<AdminSession | undefined> {
  const visit = await openVisitFor(db, request, now)
  if (!visit) return undefined
  await db.batch([requestAudit(db, request, visit)])
  return {
    userId: request.user!.id,
    email: request.user!.email ?? '',
    name: request.user!.name ?? '',
    role: 'support',
    permissions: supportPermissionList(),
    mustChangePassword: false,
    support: { tenantId: request.tenantId, visitExpiresAt: toIso(visit.expiresAt), grantExpiresAt: toIso(visit.grantExpiresAt) },
    supportAllowedUntil: toIso(visit.grantExpiresAt),
  }
}
