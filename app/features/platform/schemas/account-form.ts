import type { AccountBan, PlatformAccountSummary } from '#shared/contracts/accounts'

/** What an account does on the platform, in a few words: "Owner of 2 cafes · Staff at 1". */
export function accessLine(account: Pick<PlatformAccountSummary, 'isSuperadmin' | 'ownerOf' | 'staffOf'>): string {
  const parts: string[] = []
  if (account.isSuperadmin) parts.push('Super admin')
  if (account.ownerOf) parts.push(`Owner of ${account.ownerOf} ${account.ownerOf === 1 ? 'cafe' : 'cafes'}`)
  if (account.staffOf) parts.push(`Staff at ${account.staffOf}`)
  return parts.length ? parts.join(' · ') : 'Customer'
}

const dateTime = (at: string) => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export function banLine(ban: AccountBan): string {
  return ban.until ? `Banned until ${dateTime(ban.until)}` : 'Banned until unbanned'
}

/** How long a ban lasts: the ban dialog's choices. */
export const BAN_DURATIONS = [
  { label: 'Until I unban them', value: 'forever' },
  { label: '1 day', value: '1' },
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
] as const
export type BanDuration = typeof BAN_DURATIONS[number]['value']

/** When a ban of this length ends, as the API takes it; `null`: until unbanned. */
export function banUntil(duration: BanDuration, now = new Date()): string | null {
  if (duration === 'forever') return null
  return new Date(now.getTime() + Number(duration) * 24 * 60 * 60 * 1000).toISOString()
}
