import type { ReportBranch, ReportSummary } from '#shared/contracts/reports'
import { ApiError } from '~/utils/api-error'
import { setupRows } from '../utils/setup'

/** "Set up your cafe" (D155): every feature's step, checked at once; a failed check doesn't stop the others. */
export function useSetupChecklist() {
  const steps = adminSetupSteps()
  return useApiQuery('dashboard:setup', async () => setupRows(steps, await Promise.allSettled(steps.map(step => step.check()))))
}

export interface BranchToday {
  branch: ReportBranch
  summary: ReportSummary | null
  error: ApiError | null
}

/** Today in every branch (D155): the Reports summary for the branch's business date. */
export function useToday() {
  return useApiQuery('dashboard:today', async (): Promise<BranchToday[]> => {
    const branches = await apiFetch<ReportBranch[]>('/admin/reports/branches')
    return Promise.all(branches.map(async (branch) => {
      try {
        const summary = await apiFetch<ReportSummary>('/admin/reports/summary', { query: { branchId: branch.id, from: branch.today, to: branch.today } })
        return { branch, summary, error: null }
      }
      catch (error) {
        return { branch, summary: null, error: ApiError.from(error) }
      }
    }))
  })
}
