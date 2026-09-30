import type { LocationQuery } from 'vue-router'
import type { ItemSalesReport, OrderHistory, OrderHistoryDetail, ReportBranch, ReportPeriodQuery, ReportSummary } from '#shared/contracts/reports'
import { csvFilename } from '#shared/contracts/reports'
import type { Period } from '../utils/period'
import { validPeriod } from '../utils/period'

/**
 * The reports' data (step 8.1b, D111): the branch and period every report page shares, kept in the
 * URL (`?from=2026-09-24&to=2026-09-30`, `&branch=` only when there are several branches) and
 * remembered in this tab, so moving between Summary, Sales by item and Order history keeps them.
 * No dates in the URL means today, in the branch's zone (the server says which date that is).
 */

export function useReportBranches() {
  return useApiQuery('reports:branches', () => apiFetch<ReportBranch[]>('/admin/reports/branches'))
}

const text = (query: LocationQuery, key: string) => {
  const value = query[key]
  return typeof value === 'string' && value ? value : undefined
}

export function useReportScope() {
  const route = useRoute()
  const router = useRouter()
  const path = route.path
  const branches = useReportBranches()
  // Not user data: which branch and dates this tab last looked at.
  const remembered = useState<Partial<ReportPeriodQuery>>('report-scope', () => ({}))

  const branch = computed<ReportBranch | undefined>(() => {
    const list = branches.data.value ?? []
    const id = text(route.query, 'branch') ?? remembered.value.branchId
    return list.find(b => b.id === id) ?? list[0]
  })
  const period = computed<Period | undefined>(() => {
    if (!branch.value) return undefined
    const hasDates = text(route.query, 'from') !== undefined
    return hasDates
      ? validPeriod(text(route.query, 'from'), text(route.query, 'to'), branch.value.today)
      : validPeriod(remembered.value.from, remembered.value.to, branch.value.today)
  })
  /** The branch and period to ask the server for; `undefined` while the branches load. */
  const scope = computed<ReportPeriodQuery | undefined>(() =>
    branch.value && period.value ? { branchId: branch.value.id, from: period.value.from, to: period.value.to } : undefined)

  // The URL always says what's shown (links and reloads keep it), without adding history entries.
  // Watched by value: `scope` reads `remembered`, so a new object each time would loop.
  watch(() => scope.value && `${scope.value.branchId}|${scope.value.from}|${scope.value.to}`, () => {
    const current = scope.value
    if (!current || router.currentRoute.value.path !== path) return
    remembered.value = { ...current }
    const several = (branches.data.value?.length ?? 0) > 1
    const next: LocationQuery = { ...route.query, from: current.from, to: current.to }
    if (several) next.branch = current.branchId
    else delete next.branch
    if (JSON.stringify(next) !== JSON.stringify(route.query)) router.replace({ query: next })
  }, { immediate: true })

  /** A new period starts the lists at page 1 (usePaginatedQuery reads the page from the URL). */
  function setPeriod(next: Period) {
    const { page: _, ...rest } = route.query
    router.replace({ query: { ...rest, from: next.from, to: next.to } })
  }

  function setBranch(branchId: string) {
    const { page: _, ...rest } = route.query
    router.replace({ query: { ...rest, branch: branchId } })
  }

  return { branches, branch, period, scope, setPeriod, setBranch }
}

/**
 * A report's query: it waits for the scope (the branches load first), then refetches when the
 * scope or filters change, cancelling the older request (D30).
 */
function useReportQuery<T>(key: MaybeRefOrGetter<string>, path: string, query: MaybeRefOrGetter<Record<string, unknown> | undefined>) {
  return useApiQuery(
    key,
    async () => {
      const current = toValue(query)
      return current ? apiFetch<T>(path, { query: current }) : null
    },
    { watch: [() => JSON.stringify(toValue(query))], immediate: Boolean(toValue(query)) },
  )
}

export const useReportSummary = (scope: MaybeRefOrGetter<ReportPeriodQuery | undefined>) =>
  useReportQuery<ReportSummary>('reports:summary', '/admin/reports/summary', scope)

export const useItemSales = (query: MaybeRefOrGetter<Record<string, unknown> | undefined>) =>
  useReportQuery<ItemSalesReport>('reports:items', '/admin/reports/items', query)

export const useOrderHistory = (query: MaybeRefOrGetter<Record<string, unknown> | undefined>) =>
  useReportQuery<OrderHistory>('reports:orders', '/admin/reports/orders', query)

export function useOrderHistoryDetail(id: MaybeRefOrGetter<string | undefined>) {
  return useApiQuery(
    () => `reports:order:${toValue(id) ?? ''}`,
    async () => {
      const current = toValue(id)
      return current ? apiFetch<OrderHistoryDetail>(`/admin/reports/orders/${current}`) : null
    },
  )
}

export type ReportKind = 'summary' | 'items' | 'orders'

export interface DownloadInput {
  kind: ReportKind
  branchName: string
  /** The page's period and filters: the file holds every matching row, in the page's order. */
  query: ReportPeriodQuery & Record<string, unknown>
}

/**
 * Download CSV: fetched through `apiFetch` (the session and `ApiError` apply, so a refusal shows its
 * reason), then saved as a file. The browser's text decoding drops the byte-order mark the server
 * sent, so it's put back: Excel needs it to read Khmer and ៛ as UTF-8.
 */
export function useReportDownload() {
  return useMutation(
    async (input: DownloadInput) => {
      const { page: _, pageSize: __, ...query } = input.query
      const csv = await apiFetch<string>(`/admin/reports/${input.kind}.csv`, { query })
      const text = csv.startsWith('\uFEFF') ? csv : `\uFEFF${csv}`
      const filename = csvFilename(input.branchName, input.query, input.kind)
      saveFile(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename)
      return filename
    },
    {
      id: 'reports:download',
      key: input => input.kind,
      successMessage: filename => `Downloaded ${filename}`,
      errorMessage: 'Could not download the CSV',
    },
  )
}

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
