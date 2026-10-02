import { BAKONG_TOKEN_WARNING_DAYS } from '#shared/contracts/orders'

const DAY = 24 * 60 * 60_000
const formatDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Phnom_Penh' })

export interface TokenExpiry {
  /** Whole days left, counted up (13.2 is 14); 0 or less once it has passed. */
  daysLeft: number
  /** Neutral while more than 14 days are left, warning within 14, error once expired. */
  tone: 'neutral' | 'warning' | 'error'
  title: string
}

/**
 * How the Bakong token's expiry reads on Payments (step 10.16, D132), in the cafe's time zone like
 * the Telegram reminders: "Token expires 21 Dec 2026 · 80 days left", or "Token expired 21 Dec 2026".
 */
export function tokenExpiry(expiresAt: string, nowMs: number): TokenExpiry {
  const at = Date.parse(expiresAt)
  const daysLeft = Math.ceil((at - nowMs) / DAY)
  const date = formatDate.format(at)
  if (daysLeft <= 0) return { daysLeft, tone: 'error', title: `Token expired ${date}` }
  return {
    daysLeft,
    tone: daysLeft <= BAKONG_TOKEN_WARNING_DAYS ? 'warning' : 'neutral',
    title: `Token expires ${date} · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`,
  }
}
