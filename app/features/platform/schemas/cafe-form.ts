import type { CreateTenantInput, TenantUsage } from '#shared/contracts/tenants'
import { createTenantSchema } from '#shared/contracts/tenants'
import { pluralize } from '~/utils/text'

/**
 * The New cafe form (D142): the cafe, its first branch and its first owner. The contract's schema
 * is the form's, so the form refuses exactly what the server would; the server also checks the
 * time zone and that the address is free.
 */
export const cafeFormSchema = createTenantSchema
export type CafeForm = CreateTenantInput

/** The first branch's zone is the platform's home zone until someone picks another. */
export function emptyCafeForm(timezone = 'Asia/Phnom_Penh'): CafeForm {
  return { name: '', slug: '', branchName: 'Main branch', timezone, ownerName: '', ownerEmail: '' }
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
