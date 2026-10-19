import type { BakongTokenState, JobState } from '#shared/contracts/platform-health'

/** System health in words (step P4, D192). */

export const JOB_LABELS: Record<string, string> = {
  'platform:deliver-outbox': 'Deliver messages and emails',
  'orders:expire-unpaid': 'Expire unpaid orders',
  'notifications:deliver': 'Send Telegram notifications',
  'marketing:deliver-posts': 'Publish marketing posts',
  'platform:expire-idempotency-keys': 'Clean up retry keys',
  'assistant:purge-usage': 'Clean up assistant usage',
  'notifications:purge-deliveries': 'Clean up old notifications',
  'media:purge-temporary': 'Clean up unused uploads',
  'platform:maintain-outbox': 'Tidy the outbox',
}

const SCHEDULES: Record<string, string> = {
  '* * * * *': 'Every minute',
  '5 * * * *': 'Hourly, at :05 UTC',
  '15 3 * * *': 'Daily, 03:15 UTC',
}
export const scheduleLabel = (cron: string) => SCHEDULES[cron] ?? cron

export const JOB_STATES: Record<JobState, { label: string, color: 'success' | 'error' | 'neutral' }> = {
  ok: { label: 'OK', color: 'success' },
  failing: { label: 'Failing', color: 'error' },
  never: { label: 'No run recorded', color: 'neutral' },
}

export const BAKONG_STATES: Record<BakongTokenState, { label: string, color: 'success' | 'warning' | 'error' | 'neutral' }> = {
  expired: { label: 'Expired', color: 'error' },
  soon: { label: 'Expires soon', color: 'warning' },
  ok: { label: 'OK', color: 'success' },
  unknown: { label: 'No expiry date', color: 'neutral' },
}

export const OUTBOX_KINDS: Record<string, string> = {
  'orders.event': 'Order alerts',
  'orders.placed': 'Order placed',
  'orders.paid': 'Order paid',
  'identity.reset-password': 'Password reset emails',
  'identity.verify-email': 'Verification emails',
  'mail.test': 'Test emails',
}
export const outboxKindLabel = (kind: string) => OUTBOX_KINDS[kind] ?? kind

export const dateTime = (at: string | null) => (at
  ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'Never')
export const dateOnly = (at: string) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
