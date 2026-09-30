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

/**
 * A "nice" top for the axis and its steps, in cents: the smallest 1, 2 or 5 × 10ⁿ step with at most
 * four steps covering the highest bar. `niceScale(24_950)` → top 30,000, step 10,000.
 */
export function niceScale(maxMinor: number): { top: number, step: number } {
  if (maxMinor <= 0) return { top: 100, step: 100 }
  const rough = maxMinor / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map(m => m * magnitude).find(s => s >= rough)!
  return { top: Math.ceil(maxMinor / step) * step, step }
}
