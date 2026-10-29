import { and, asc, count, desc, eq, gt, gte, inArray, isNull, ne, not, or, sql } from 'drizzle-orm'
import type { TenantListQuery, TenantStatus } from '#shared/contracts/tenants'
import type { Db, Statement } from '#server/utils/batch'
import { readInChunks } from '#server/utils/batch'
import { byName, firstRow, inTenant, readPage, searchIn } from '#server/utils/query'
import { hasActiveOwner } from '#server/features/identity'
import { organization } from '#server/db/tables'
import { tenantNotes, tenantSlugs } from './tenants.schema'

// --- Row types ---

export interface TenantRow {
  id: string
  name: string
  slug: string
  status: string | null
  suspendedReason: string | null
  logoAssetId: string | null
  version: number | null
  createdAt: Date
}

export interface TenantNotesRow {
  contactName: string | null
  contactPhone: string | null
  notes: string | null
  version: number
  updatedAt: Date
}

export interface NotesValues {
  contactName: string | null
  contactPhone: string | null
  notes: string | null
  updatedBy: string
  now: Date
}

// --- Column lists and conditions ---

const tenantColumns = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  status: organization.status,
  suspendedReason: organization.suspendedReason,
  logoAssetId: organization.logoAssetId,
  version: organization.version,
  createdAt: organization.createdAt,
}

/** A cafe created before `status` existed counts as active. */
export const activeCafe = or(eq(organization.status, 'active'), isNull(organization.status))!

const statusIs = (status: TenantStatus) => status === 'active' ? activeCafe : eq(organization.status, status)

// --- Reads ---

/** Across cafes: counts for the console's Overview (D191): cafes created since `since`, and cafes without an active owner. */
export async function overviewCounts(db: Db, since: Date): Promise<{ created: number, ownerless: number }> {
  const rows = await db.select({
    created: sql<number>`coalesce(sum(case when ${gte(organization.createdAt, since)} then 1 else 0 end), 0)`.mapWith(Number),
    ownerless: sql<number>`coalesce(sum(case when ${not(hasActiveOwner(db, organization.id))} then 1 else 0 end), 0)`.mapWith(Number),
  }).from(organization)
  return rows[0] ?? { created: 0, ownerless: 0 }
}

/** Across cafes: every active cafe's id (a cafe created before `status` existed counts as active). */
export async function listActiveTenantIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: organization.id }).from(organization).where(statusIs('active'))
  return rows.map(row => row.id)
}

/** Across cafes: how many cafes each status holds: one grouped read. */
export async function countTenants(db: Db): Promise<{ status: TenantStatus, total: number }[]> {
  const status = sql<TenantStatus>`coalesce(${organization.status}, 'active')`
  return db.select({ status, total: count() }).from(organization).groupBy(status)
}

/** Across cafes: cafes by name, filtered by name or address and status, a page at a time. */
export async function listTenants(db: Db, query: TenantListQuery): Promise<{ rows: TenantRow[], total: number }> {
  const where = and(
    searchIn(query.search, organization.name, organization.slug),
    query.status ? statusIs(query.status) : undefined,
    query.owner === 'none' ? not(hasActiveOwner(db, organization.id)) : undefined,
  )
  return readPage(db,
    db.select(tenantColumns).from(organization).where(where).orderBy(byName(organization.name), asc(organization.id)).$dynamic(),
    db.select({ total: count() }).from(organization).where(where), query)
}

export async function findTenant(db: Db, id: string): Promise<TenantRow | undefined> {
  return firstRow(db.select(tenantColumns).from(organization).where(eq(organization.id, id)))
}

/** Across cafes: the cafe with this current address (a former one isn't it: pages redirect from those). */
export async function findTenantBySlug(db: Db, slug: string): Promise<TenantRow | undefined> {
  return firstRow(db.select(tenantColumns).from(organization).where(eq(organization.slug, slug)))
}

/** Across cafes: the cafe that has (or had) this address; `undefined` when no cafe ever used it. */
export async function findSlugOwner(db: Db, slug: string): Promise<string | undefined> {
  return (await firstRow(db.select({ tenantId: tenantSlugs.tenantId }).from(tenantSlugs).where(eq(tenantSlugs.slug, slug))))?.tenantId
}

/** The addresses a cafe had before its current one, newest first. */
export async function slugsOf(db: Db, tenantId: string, current: string): Promise<string[]> {
  const rows = await db.select({ slug: tenantSlugs.slug }).from(tenantSlugs)
    .where(inTenant(tenantSlugs, tenantId, ne(tenantSlugs.slug, current)))
    .orderBy(desc(tenantSlugs.createdAt), asc(tenantSlugs.slug))
  return rows.map(row => row.slug)
}

/** Across cafes: these cafes' ids, names and addresses, by name (the platform console names an account's cafes, D146). */
export async function findTenantRefs(db: Db, ids: string[]): Promise<{ id: string, name: string, slug: string }[]> {
  const rows = await readInChunks(ids, chunk => db.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization)
    .where(inArray(organization.id, chunk)))
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id))
}

export async function findNotes(db: Db, tenantId: string): Promise<TenantNotesRow | undefined> {
  return firstRow(db.select({
    contactName: tenantNotes.contactName,
    contactPhone: tenantNotes.contactPhone,
    notes: tenantNotes.notes,
    version: tenantNotes.version,
    updatedAt: tenantNotes.updatedAt,
  }).from(tenantNotes).where(inTenant(tenantNotes, tenantId)))
}

/** This cafe while it is active (by primary key); `undefined` when it's missing or suspended. */
export function findActiveTenant(db: Db, id: string): Promise<{ id: string, slug: string, name: string } | undefined> {
  return firstRow(db.select({ id: organization.id, slug: organization.slug, name: organization.name }).from(organization)
    .where(and(eq(organization.id, id), activeCafe)))
}

/** Across cafes: bounded platform-task enumeration; UUIDs provide a stable cursor. */
export function listActiveTenantPage(db: Db, after: string | null, limit: number): Promise<{ id: string, slug: string, name: string }[]> {
  return db.select({ id: organization.id, slug: organization.slug, name: organization.name }).from(organization)
    .where(and(activeCafe, after ? gt(organization.id, after) : undefined)).orderBy(asc(organization.id)).limit(limit)
}

/** Across cafes: these cafes by id (account's own cafe list or the platform console). */
export function findTenants(db: Db, ids: string[]): Promise<TenantRow[]> {
  return readInChunks(ids, piece => db.select(tenantColumns).from(organization).where(inArray(organization.id, piece)))
}

// --- Write statements ---

export function insertTenantStatement(db: Db, row: { id: string, name: string, slug: string, now: Date }): Statement {
  return db.insert(organization).values({ id: row.id, name: row.name, slug: row.slug, status: 'active', version: 1, createdAt: row.now })
}

/**
 * Records an address as the cafe's. The slug is the key: a second cafe's insert of an address
 * any cafe has ever had fails as a unique violation, so two saves can't take one address.
 */
export function insertSlugStatement(db: Db, row: { slug: string, tenantId: string, now: Date }): Statement {
  return db.insert(tenantSlugs).values({ slug: row.slug, tenantId: row.tenantId, createdAt: row.now })
}

/** Forgets the cafe's own former address before it takes it back (only its own: never another cafe's). */
export function forgetOwnSlugStatement(db: Db, tenantId: string, slug: string): Statement {
  return db.delete(tenantSlugs).where(inTenant(tenantSlugs, tenantId, eq(tenantSlugs.slug, slug)))
}

/** Changes the cafe only at the version read. Follow it with `requireOneChange`. */
export function updateTenantStatement(db: Db, id: string, version: number, values: { status?: TenantStatus, suspendedReason?: string | null, slug?: string, name?: string, logoAssetId?: string | null }): Statement {
  return db.update(organization)
    .set({ ...values, version: version + 1 })
    .where(and(eq(organization.id, id), sql`coalesce(${organization.version}, 1) = ${version}`))
}

/** The cafe's first notes: a second first save fails on the key (the cafe's id). */
export function insertNotesStatement(db: Db, tenantId: string, values: NotesValues): Statement {
  const { now, ...fields } = values
  return db.insert(tenantNotes).values({ tenantId, ...fields, version: 1, updatedAt: now })
}

/** Replaces the notes only at the version read. Follow it with `requireOneChange`. */
export function updateNotesStatement(db: Db, tenantId: string, version: number, values: NotesValues): Statement {
  const { now, ...fields } = values
  return db.update(tenantNotes)
    .set({ ...fields, version: version + 1, updatedAt: now })
    .where(inTenant(tenantNotes, tenantId, eq(tenantNotes.version, version)))
}
