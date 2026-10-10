import type { AdminSetupStep } from '~/types/admin-setup'

export type SetupState = 'done' | 'todo' | 'failed'
export interface SetupRow {
  step: AdminSetupStep
  state: SetupState
}

/**
 * The checklist from each step's answer (D155): a step that doesn't apply here is left out, one
 * whose check failed says so (and doesn't count as done). Steps still to do come first, required
 * before optional, then the done ones; each group keeps the listed order.
 */
export function setupRows(steps: readonly AdminSetupStep[], answers: readonly PromiseSettledResult<boolean | null>[]): SetupRow[] {
  const rows = steps.flatMap((step, i): SetupRow[] => {
    const answer = answers[i]
    if (!answer || answer.status === 'rejected') return [{ step, state: 'failed' }]
    if (answer.value === null) return []
    return [{ step, state: answer.value ? 'done' : 'todo' }]
  })
  const rank = (row: SetupRow) => (row.state === 'done' ? 2 : row.step.optional ? 1 : 0)
  return rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i).map(({ row }) => row)
}

/** Whether a cafe still has a required step to do: the checklist shows itself again until then. */
export const requiredLeft = (rows: readonly SetupRow[]) => rows.some(row => row.state !== 'done' && !row.step.optional)
