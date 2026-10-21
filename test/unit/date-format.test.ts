import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatDay, formatShortDate, formatShortDateTime, formatTime } from '../../app/utils/date-format'

// 21 Oct 2026, 02:05 UTC: 9:05 AM in Phnom Penh (UTC+7), still 20 Oct in Los Angeles.
const AT = '2026-10-21T02:05:00.000Z'
const PHNOM_PENH = { timeZone: 'Asia/Phnom_Penh' }
/** Intl writes the narrow no-break space before AM/PM; the tests read it as a space. */
const plain = (text: string) => text.replace(/\u202F/g, ' ')

describe('date formats: the day first, the 12-hour clock', () => {
  it('formats a moment in the zone it is given', () => {
    expect(formatDate(AT, PHNOM_PENH)).toBe('21 Oct 2026')
    expect(formatShortDate(AT, PHNOM_PENH)).toBe('21 Oct')
    expect(plain(formatTime(AT, PHNOM_PENH))).toBe('9:05 AM')
    expect(plain(formatDateTime(AT, PHNOM_PENH))).toBe('21 Oct 2026, 9:05 AM')
    expect(plain(formatShortDateTime(AT, PHNOM_PENH))).toBe('21 Oct, 9:05 AM')
    expect(formatDate(AT, { timeZone: 'America/Los_Angeles' })).toBe('20 Oct 2026')
  })

  it('takes an ISO string, epoch milliseconds or a Date alike', () => {
    expect(formatDate(Date.parse(AT), PHNOM_PENH)).toBe('21 Oct 2026')
    expect(formatDate(new Date(AT), PHNOM_PENH)).toBe('21 Oct 2026')
  })

  it('shows a calendar day the same in every zone', () => {
    expect(formatDay('2026-10-21')).toBe('Wed 21 Oct 2026')
    expect(formatDay('2027-01-01')).toBe('Fri 1 Jan 2027')
  })
})
