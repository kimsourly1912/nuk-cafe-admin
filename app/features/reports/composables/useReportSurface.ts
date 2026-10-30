import type { InjectionKey } from 'vue'

export type ReportPage = 'summary' | 'items' | 'orders'

/**
 * Where the report pages run (D198): the admin's Reports, or a manager's on the counter for one
 * branch. It sets the API they read, their cache keys (a counter's never shows the admin's cached
 * branches), their links, and what they offer: CSV and Send to Telegram are the admin's only
 * (`report: ['export']`, owners). The server checks all of it again.
 */
export interface ReportSurface {
  /** API path the reports are under: `/admin/reports` or `/counter/<branchId>/reports`. */
  api: string
  /** Prefix of this surface's query keys. */
  key: string
  /** The page of a report, with the cafe's address. */
  page: (report: ReportPage) => string
  /** The counter branch, when on the counter. */
  counterBranchId?: string
  /** Download CSV and Send to Telegram. */
  exports: boolean
  /** An owner's refund of a ready or completed order (D233): the admin's only. */
  refunds: boolean
}

const SURFACE: InjectionKey<ReportSurface> = Symbol('report-surface')

/** A manager's reports for one branch; provided by the counter's report page. */
export function provideCounterReportSurface(branchId: string) {
  const tenantPath = useTenantPath()
  provide(SURFACE, {
    api: `/counter/${branchId}/reports`,
    key: `reports:counter:${branchId}`,
    page: report => tenantPath(`/counter/${branchId}/reports/${report}`),
    counterBranchId: branchId,
    exports: false,
    refunds: false,
  })
}

/** The surface the page runs on: the admin's unless the counter provided one. */
export function useReportSurface(): ReportSurface {
  const tenantPath = useTenantPath()
  return inject(SURFACE, () => ({
    api: '/admin/reports',
    key: 'reports',
    page: (report: ReportPage) => tenantPath(`/admin/reports/${report}`),
    exports: true,
    refunds: true,
  }), true)
}
