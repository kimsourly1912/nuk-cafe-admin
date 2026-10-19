import type { OwnerKind, PlatformOwner, TenantUsage } from '#shared/contracts/tenants'
import { createTenantSchema } from '#shared/contracts/tenants'
import { pluralize, previewList } from '~/utils/text'

/**
 * The New cafe form (D142, D146, D185): the cafe, its first branch and its first owner. The contract's
 * schema is the form's, so the form refuses exactly what the server would; the server also checks
 * the time zone, that the address is free and who owns cafes.
 */
export const cafeFormSchema = createTenantSchema

/**
 * The form's state. The owner keeps both choices' fields, so switching between "An existing owner"
 * and "A new person" loses nothing; the schema's output keeps only the chosen one's.
 */
export interface CafeForm {
  name: string
  slug: string
  branchName: string
  timezone: string
  owner: { kind: OwnerKind, userId: string, name: string, email: string }
}

/**
 * An empty form; the first branch's zone is the platform's home zone until someone picks another.
 * With `ownerId` (New cafe for this owner, on a cafe's page) that account is already chosen: its
 * name and email come from the account, never from the page's address.
 */
export function emptyCafeForm(options: { timezone?: string, ownerId?: string } = {}): CafeForm {
  const { timezone = 'Asia/Phnom_Penh', ownerId } = options
  return {
    name: '',
    slug: '',
    branchName: 'Main branch',
    timezone,
    owner: ownerId ? { kind: 'existing', userId: ownerId, name: '', email: '' } : { kind: 'new', userId: '', name: '', email: '' },
  }
}

/** "Bea Brown (bea@example.com)": an owner in the list, found by name or email. */
export const ownerLabel = (owner: { name: string, email: string }) => `${owner.name} (${owner.email})`

/** "NUK Cafe", "NUK Cafe and Brown Bean", "A, B, C and 2 more". */
function cafeNames(owner: PlatformOwner): string {
  const names = owner.cafes.map(cafe => cafe.name)
  if (names.length < 2 || names.length > 3) return previewList(names, 3)
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** "Owns NUK Cafe and Brown Bean": what a chosen owner already runs. */
export function ownedCafesLine(owner: PlatformOwner): string {
  return owner.cafes.length ? `Owns ${cafeNames(owner)}` : 'Owns no cafe yet'
}

/** The result after saving: "Bea Brown now owns 2 cafes: NUK Cafe and Brown Bean." */
export function nowOwnsLine(owner: PlatformOwner): string {
  if (owner.cafes.length < 2) return `${owner.name} owns this cafe.`
  return `${owner.name} now owns ${pluralize(owner.cafes.length, ['cafe', 'cafes'])}: ${cafeNames(owner)}.`
}

/** "1 branch · 3 staff · 12 orders in 30 days": a cafe's usage on one line. */
export function usageLine(usage: TenantUsage): string {
  return [
    pluralize(usage.branches, ['branch', 'branches']),
    `${usage.staff} staff`,
    `${pluralize(usage.ordersLast30Days, ['order', 'orders'])} in 30 days`,
  ].join(' · ')
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]]

/** "2 hours ago", "yesterday", "just now". */
export function timeAgo(at: string, now = new Date()): string {
  const ago = now.getTime() - new Date(at).getTime()
  for (const [unit, ms] of UNITS) {
    if (ago >= ms) return rtf.format(-Math.floor(ago / ms), unit)
  }
  return 'just now'
}

/** "Last order 2 hours ago"; "No orders yet" without one. */
export function lastOrderText(at: string | null, now = new Date()): string {
  return at ? `Last order ${timeAgo(at, now)}` : 'No orders yet'
}

/**
 * What follows creating the cafe, for the summary beside the form: a new account's owner gets a
 * temporary password to change; an existing account signs in as before, so nothing here promises
 * a password for it.
 */
export function afterCreationSteps(kind: OwnerKind): string[] {
  const setup = 'The owner sets up the menu and payments'
  return kind === 'new'
    ? ['Copy the owner\'s sign-in details', 'The owner changes the temporary password', setup]
    : ['The owner signs in with their current password', 'The cafe appears under Your cafes', setup]
}
