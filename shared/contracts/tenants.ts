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

export const OWNER_KINDS = ['existing', 'new'] as const
export type OwnerKind = typeof OWNER_KINDS[number]

/** An account's id as a page address or a lookup carries it: never a password or another secret. */
export const accountIdSchema = v.pipe(v.string(), v.trim(), v.uuid())

/**
 * The first owner (D146, D185): an existing account (a registered customer, branch staff or an
 * owner of other cafes; it keeps its password, profile and other access) or a new person, who gets
 * a new account with a temporary password. Only the id of an existing account is taken: its name
 * and email come from the account itself.
 */
export const newCafeOwnerSchema = v.variant('kind', [
  v.object({
    kind: v.literal('existing'),
    userId: v.pipe(v.string('Choose an account'), v.trim(), v.minLength(1, 'Choose an account'), v.maxLength(64)),
  }),
  v.object({
    kind: v.literal('new'),
    name: nameSchema(100),
    email: emailSchema,
  }),
])
export type NewCafeOwner = v.InferOutput<typeof newCafeOwnerSchema>

/** `POST /api/platform/tenants`: the cafe, its first branch and its first owner, in one save. */
export const createTenantSchema = v.object({
  name: nameSchema(80),
  slug: slugSchema,
  branchName: nameSchema(100),
  /** An IANA zone (`Asia/Phnom_Penh`); the server checks it's known. */
  timezone: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(64)),
  owner: newCafeOwnerSchema,
})
export type CreateTenantInput = v.InferOutput<typeof createTenantSchema>

export const OWNER_SEARCH_MIN = 2

/** `GET /api/platform/accounts?search=`: a name or email, at least two characters. */
export const ownerSearchQuerySchema = v.object({
  search: v.pipe(v.string(), v.trim(), v.minLength(OWNER_SEARCH_MIN, `Type at least ${OWNER_SEARCH_MIN} characters`), v.maxLength(100)),
})
export type OwnerSearchQuery = v.InferOutput<typeof ownerSearchQuerySchema>

/** `GET /api/platform/slug-availability?slug=`: an address that already passes the address rules. */
export const slugAvailabilityQuerySchema = v.object({ slug: slugSchema })

/** Whether no cafe has or had the address. Advisory: creating the cafe decides. */
export interface SlugAvailability {
  slug: string
  available: boolean
}

export const tenantListQuerySchema = v.object({
  ...pageQuerySchema,
  search: optionalParam(v.pipe(v.string(), v.trim(), v.maxLength(100))),
  status: optionalParam(v.picklist(TENANT_STATUSES)),
})
export type TenantListQuery = v.InferOutput<typeof tenantListQuerySchema>

/** `GET /platform/tenants/counts`: how many cafes each status holds, for the list's tabs. */
export type TenantCounts = Record<TenantStatus, number>

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

/** A cafe as the console names it in a list (an owner's cafes). */
export interface CafeRef {
  id: string
  name: string
  slug: string
}

/**
 * An account that can own a cafe, with the cafes it owns already (`GET /api/platform/accounts`,
 * D185): New cafe's "Use existing account". Guests and disabled accounts never are.
 */
export interface PlatformOwner {
  id: string
  name: string
  email: string
  cafes: CafeRef[]
}

export interface CreatedTenant {
  tenant: TenantDetail
  /**
   * The first owner's temporary password, shown once; `null` when the owner already had an
   * account (they sign in with their own password).
   */
  temporaryPassword: string | null
  /** The first owner with every cafe they own now, the new one included (D146). */
  owner: PlatformOwner
}

/** `GET /api/platform/me`: the signed-in super admin, for the platform console. */
export interface PlatformSession {
  userId: string
  email: string
  name: string
  mustChangePassword: boolean
}
