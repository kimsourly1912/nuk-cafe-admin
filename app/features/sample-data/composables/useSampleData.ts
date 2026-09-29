import type { SampleBranchResult, SampleDataState, SampleMenuSize } from '#shared/contracts/sample-data'

/**
 * The Sample data page's data and actions (D94). Every action is a loop of small server steps (a
 * Worker request may run only so many queries): the page repeats a step until the server says it's
 * done, and shows the state each step returns. The three mutations share one lock, so only one runs
 * at a time. Leaving the page stops the loop after the step in flight; the load continues from
 * there next time ("Continue loading").
 *
 * Lists elsewhere are refreshed once at the end, not after every step (a load is dozens of steps,
 * and every step would also reach the app's other tabs).
 */

/** Everything loading or resetting touches. */
const TOUCHED = ['sample-data', 'categories', 'products', 'option-sets', 'modifier-groups', 'availability-rules', 'branches', 'menu']

export function useSampleData() {
  const query = useApiQuery('sample-data:state', () => apiFetch<SampleDataState>('/admin/sample-data'))

  const menuStep = useMutation(
    (size: SampleMenuSize) => apiFetch<SampleDataState>('/admin/sample-data/menu', { method: 'POST', body: { size } }),
    { id: 'sample-data:menu', lock: () => 'sample-data', successMessage: false, errorMessage: 'The sample menu stopped loading' },
  )
  const branchStep = useMutation(
    (input: { branchId: string, tablesOnly: boolean }) => apiFetch<SampleBranchResult>('/admin/sample-data/branch', { method: 'POST', body: input }),
    { id: 'sample-data:branch', lock: () => 'sample-data', successMessage: false, errorMessage: 'Sample hours and tables stopped loading' },
  )
  const resetStep = useMutation(
    () => apiFetch<SampleDataState>('/admin/sample-data/reset', { method: 'POST', body: { confirm: 'RESET' } }),
    { id: 'sample-data:reset', lock: () => 'sample-data', successMessage: false, errorMessage: 'The reset stopped' },
  )

  /** Which action's loop is running. */
  const running = ref<'menu' | 'branch' | 'reset'>()
  /** Why the last menu load stopped (shown on its card until it's continued). */
  const menuError = ref<string>()
  const branchError = ref<string>()
  let leaving = false
  onScopeDispose(() => {
    leaving = true
  })

  function show(state: SampleDataState) {
    query.data.value = state
  }

  /** Steps until the sample menu is loaded, the server refuses, or the page is left. */
  async function loadMenu(size: SampleMenuSize) {
    running.value = 'menu'
    menuError.value = undefined
    while (!leaving) {
      const result = await menuStep.execute(size)
      if (!result.ok) {
        if (result.status === 'error') menuError.value = result.error.message
        break
      }
      show(result.data)
      if (result.data.menu.run?.finished) break
    }
    running.value = undefined
    invalidate(...TOUCHED)
  }

  /** The hours, then the tables a few at a time. */
  async function loadBranch(branchId: string) {
    running.value = 'branch'
    branchError.value = undefined
    let tablesOnly = false
    while (!leaving) {
      const result = await branchStep.execute({ branchId, tablesOnly })
      if (!result.ok) {
        if (result.status === 'error') branchError.value = result.error.message
        break
      }
      show(result.data.state)
      if (!result.data.remainingTables) break
      tablesOnly = true
    }
    running.value = undefined
    invalidate(...TOUCHED)
  }

  /** Deletes the menu, then the photos a batch at a time; `true` once everything is gone. */
  async function resetMenu(): Promise<boolean> {
    running.value = 'reset'
    menuError.value = undefined
    let done = false
    while (!leaving) {
      const result = await resetStep.execute(undefined)
      if (!result.ok) break
      show(result.data)
      if (!result.data.menu.counts.photos) {
        done = true
        break
      }
    }
    running.value = undefined
    invalidate(...TOUCHED)
    return done
  }

  return { ...query, running, menuError, branchError, loadMenu, loadBranch, resetMenu }
}
