import type { ActivityEntry, ActivityPerson, PlatformAction } from '#shared/contracts/platform-activity'

/**
 * The console's Activity in words (step P3, D191): one line per action, the platform team's own
 * history. Names come from the server; an account that can't be found shows as "an account".
 */

export const ACTION_LABELS: Record<PlatformAction, string> = {
  'tenant.create': 'Cafe created',
  'tenant.suspend': 'Cafe paused',
  'tenant.resume': 'Cafe resumed',
  'tenant.slug.change': 'Address changed',
  'tenant.owner.add': 'Owner added',
  'tenant.owner.remove': 'Owner removed',
  'tenant.owner.transfer': 'Ownership transferred',
  'tenant.notes.update': 'Notes edited',
  'platform.account.ban': 'Account banned',
  'platform.account.unban': 'Account unbanned',
  'platform.account.sign-out': 'Signed out everywhere',
  'platform.account.password.temporary': 'Temporary password set',
  'platform.superadmin.grant': 'Super admin granted',
}

const NOTE_FIELDS: Record<string, string> = { contactName: 'contact person', contactPhone: 'phone', notes: 'notes' }

export const personName = (person: ActivityPerson | null) => person?.name ?? person?.email ?? 'an account'
export const actorName = (entry: Pick<ActivityEntry, 'actor'>) => (entry.actor ? personName(entry.actor) : 'The system')

/** What happened, beyond the action's name: "Bea Brown, a new account", "/c/old → /c/new". */
export function activitySubject(entry: ActivityEntry): string | null {
  const { details } = entry
  switch (entry.action) {
    case 'tenant.owner.add':
    case 'tenant.create':
      return entry.account ? `${personName(entry.account)}${details.newAccount ? ', a new account' : ''}` : null
    case 'tenant.owner.remove':
      return `${personName(entry.account)}${details.staysStaff ? ', keeps their branch roles' : ''}`
    case 'tenant.owner.transfer':
      return `${personName(entry.previousOwner)} → ${personName(entry.account)}${details.newAccount ? ' (a new account)' : ''}`
    case 'tenant.slug.change':
      return details.from && details.to ? `/c/${details.from} → /c/${details.to}` : null
    case 'tenant.notes.update':
      return details.fields?.length ? `Changed: ${details.fields.map(field => NOTE_FIELDS[field] ?? field).join(', ')}` : 'Saved without changes'
    case 'platform.account.ban':
      return `${personName(entry.account)}, ${details.until ? `until ${new Date(details.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'until unbanned'}`
    default:
      return entry.account ? personName(entry.account) : null
  }
}

export const ACTIVITY_PERIODS = [
  { label: 'Any time', value: 'any' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'This month', value: 'month' },
] as const
export type ActivityPeriod = typeof ACTIVITY_PERIODS[number]['value']

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** The dates a period covers in the platform's zone (both included), as the API takes them. */
export function periodDates(period: ActivityPeriod, timeZone: string, now = new Date()): { from?: string, to?: string } {
  if (period === 'any') return {}
  // en-CA writes dates as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  switch (period) {
    case 'today': return { from: today, to: today }
    case '7d': return { from: addDays(today, -6), to: today }
    case '30d': return { from: addDays(today, -29), to: today }
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today }
  }
}
