import { and, asc, count, eq, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { TenantListQuery, TenantStatus } from '#shared/contracts/tenants'
import type { Db, Statement } from '#server/utils/batch'
import { organization } from '#server/db/tables'
import { tenantSlugs } from './tenants.schema'

/**
 * All SQL of the platform console (D142): cafes (Better Auth's `organization`, D134) and their
 * address history. Only the console's service calls these; requests act in a cafe through
 * identity's `tenantBySlug`.
 */

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
const statusIs = (status: TenantStatus) => sql`coalesce(${organization.status}, 'active') = ${status}`

/** Cafes by name, filtered by name or address and status, a page at a time. */
export async function listTenants(db: Db, query: TenantListQuery): Promise<{ rows: TenantRow[], total: number }> {
  const conditions: SQL[] = []
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, c => `\\${c}`)}%`
    conditions.push(or(sql`${organization.name} like ${pattern} escape '\\'`, sql`${organization.slug} like ${pattern} escape '\\'`)!)
  }
  if (query.status) conditions.push(statusIs(query.status))
  const where = conditions.length ? and(...conditions) : undefined

  const [totals, rows] = await Promise.all([
    db.select({ total: count() }).from(organization).where(where) as Promise<{ total: number }[]>,
    db.select(tenantColumns).from(organization).where(where)
      .orderBy(sql`${organization.name} collate nocase`, asc(organization.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize) as Promise<TenantRow[]>,
  ])
  return { rows, total: totals[0]?.total ?? 0 }
}

export async function findTenant(db: Db, id: string): Promise<TenantRow | undefined> {
  const rows: TenantRow[] = await db.select(tenantColumns).from(organization).where(eq(organization.id, id)).limit(1)
  return rows[0]
}

/** The cafe with this current address (a former one isn't it: pages redirect from those). */
export async function findTenantBySlug(db: Db, slug: string): Promise<TenantRow | undefined> {
  const rows: TenantRow[] = await db.select(tenantColumns).from(organization).where(eq(organization.slug, slug)).limit(1)
  return rows[0]
}

/** The oldest cafe, for the seed task. */
export async function findOldestTenant(db: Db): Promise<TenantRow | undefined> {
  const rows: TenantRow[] = await db.select(tenantColumns).from(organization).orderBy(asc(organization.createdAt), asc(organization.id)).limit(1)
  return rows[0]
}

/** The cafe that has (or had) this address; `undefined` when no cafe ever used it. */
export async function slugOwner(db: Db, slug: string): Promise<string | undefined> {
  const rows = await db.select({ tenantId: tenantSlugs.tenantId }).from(tenantSlugs).where(eq(tenantSlugs.slug, slug)).limit(1)
  return rows[0]?.tenantId
}

/** The addresses a cafe had before its current one, newest first. */
export async function formerSlugs(db: Db, tenantId: string, current: string): Promise<string[]> {
  const rows = await db.select({ slug: tenantSlugs.slug }).from(tenantSlugs)
    .where(and(eq(tenantSlugs.tenantId, tenantId), ne(tenantSlugs.slug, current)))
    .orderBy(sql`${tenantSlugs.createdAt} desc`, asc(tenantSlugs.slug))
  return rows.map(row => row.slug)
}

// --- Writes: statements for the service's batch ---

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
export function forgetOwnSlugStatement(db: Db, slug: string, tenantId: string): Statement {
  return db.delete(tenantSlugs).where(and(eq(tenantSlugs.slug, slug), eq(tenantSlugs.tenantId, tenantId)))
}

/** Changes the cafe only at the version read: no row changes when someone changed it meanwhile. */
export function updateTenantStatement(db: Db, id: string, version: number, values: { status?: TenantStatus, suspendedReason?: string | null, slug?: string, name?: string, logoAssetId?: string | null }): Statement {
  return db.update(organization)
    .set({ ...values, version: version + 1 })
    .where(and(eq(organization.id, id), sql`coalesce(${organization.version}, 1) = ${version}`))
}
