import type { ReportSummary, TrendPoint } from '#shared/contracts/reports'

/**
 * The Summary's bar chart (D111): hours of one business day trimmed to the first and last hour with
 * sales (no empty 4 AM bars), every day of a longer period kept (a day without sales is news).
 */
export function chartPoints(trend: ReportSummary['trend']): TrendPoint[] {
  if (trend.unit === 'day') return trend.points
  const first = trend.points.findIndex(p => p.salesMinor > 0)
  if (first === -1) return []
  const last = trend.points.findLastIndex(p => p.salesMinor > 0)
  return trend.points.slice(first, last + 1)
}
