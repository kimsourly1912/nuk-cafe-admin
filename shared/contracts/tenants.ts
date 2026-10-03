import * as v from 'valibot'
import { nameSchema, optionalParam, pageQuerySchema, versionSchema } from './common'

/**
 * The platform console (`/api/platform/tenants`, step T2a, D142): super admins create cafes
 * (tenants, D134) with their first branch and owner, pause and resume them, and change their web
 * address. A super admin sees a cafe's usage numbers, never its menu, orders or customers.
 */

export const SLUG_MIN = 3
export const SLUG_MAX = 40

/**
 * Addresses no cafe may take: the platform's own paths, and names a later move to subdomains
 * (`<slug>.example.com`) would need (multi-tenant plan → Address scheme).
 */
export const RESERVED_SLUGS = new Set([
  'about', 'account', 'admin', 'api', 'app', 'assets', 'auth', 'billing', 'blog', 'c', 'cafe', 'cafes',
  'counter', 'dashboard', 'docs', 'help', 'login', 'mail', 'new', 'platform', 'root', 'sign-in',
  'sign-up', 'signin', 'signup', 'static', 'status', 'support', 'system', 'table', 'www',
])

/** A cafe's web address, `/c/<slug>`: lowercase letters, digits and single dashes. */
export const slugSchema = v.pipe(
  v.string(),
  v.trim(),
  v.toLowerCase(),
  v.minLength(SLUG_MIN, `At least ${SLUG_MIN} characters`),
  v.maxLength(SLUG_MAX, `At most ${SLUG_MAX} characters`),
  v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single dashes, starting and ending with a letter or number'),
  v.check(slug => !RESERVED_SLUGS.has(slug), 'This address is reserved'),
)

/** A suggested address from a cafe's name: "Brown Bean Café" → "brown-bean-cafe". */
export function slugFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}

export const TENANT_STATUSES = ['active', 'suspended'] as const
export type TenantStatus = typeof TENANT_STATUSES[number]

const emailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email('Must be a valid email address'), v.maxLength(254))

/** `POST /api/platform/tenants`: the cafe, its first branch and its first owner, in one save. */
export const createTenantSchema = v.object({
  name: nameSchema(80),
  slug: slugSchema,
  branchName: nameSchema(100),
  /** An IANA zone (`Asia/Phnom_Penh`); the server checks it's known. */
  timezone: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(64)),
  ownerName: nameSchema(100),
  ownerEmail: emailSchema,
})
export type CreateTenantInput = v.InferOutput<typeof createTenantSchema>

export const tenantListQuerySchema = v.object({
  ...pageQuerySchema,
  search: optionalParam(v.pipe(v.string(), v.trim(), v.maxLength(100))),
  status: optionalParam(v.picklist(TENANT_STATUSES)),
})
export type TenantListQuery = v.InferOutput<typeof tenantListQuerySchema>

export const SUSPEND_REASON_MAX = 200

/** `POST …/{id}/suspend`: why, shown to the platform team (customers see "Ordering is paused"). */
export const suspendTenantSchema = v.object({
  version: versionSchema,
  reason: nameSchema(SUSPEND_REASON_MAX),
})
export type SuspendTenantInput = v.InferOutput<typeof suspendTenantSchema>

export const resumeTenantSchema = v.object({ version: versionSchema })
export type ResumeTenantInput = v.InferOutput<typeof resumeTenantSchema>

/** `POST …/{id}/slug`: the new address; the old one keeps redirecting to it. */
export const changeTenantSlugSchema = v.object({ version: versionSchema, slug: slugSchema })
export type ChangeTenantSlugInput = v.InferOutput<typeof changeTenantSlugSchema>

/** What a super admin sees of a cafe: no menu, orders or customers (D134). */
export interface TenantUsage {
  /** Active branches. */
  branches: number
  /** People with access: owners and branch staff. */
  staff: number
  /** Orders placed in the last 30 days, at every branch. */
  ordersLast30Days: number
  lastOrderAt: string | null
}

export interface TenantSummary {
  id: string
  name: string
  slug: string
  status: TenantStatus
  suspendedReason: string | null
  createdAt: string
  /** Send it back with every change (409 when someone changed the cafe meanwhile). */
  version: number
  usage: TenantUsage
}

export interface TenantOwner {
  id: string
  name: string
  email: string
}

export interface TenantDetail extends TenantSummary {
  owners: TenantOwner[]
  /** Addresses the cafe had before; each still redirects to the current one. */
  formerSlugs: string[]
}

export interface CreatedTenant {
  tenant: TenantDetail
  /**
   * The first owner's temporary password, shown once; `null` when the email already had an
   * account (they sign in with their own password).
   */
  temporaryPassword: string | null
}

/** `GET /api/platform/me`: the signed-in super admin, for the platform console. */
export interface PlatformSession {
  userId: string
  email: string
  name: string
  mustChangePassword: boolean
}
