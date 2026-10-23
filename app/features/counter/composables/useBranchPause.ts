import type { BranchPause, PauseBranchInput } from '#shared/contracts/branches'

/**
 * The branch's pause of online orders (D199): read by everyone at the counter (the header's badge,
 * the queue's banner), set by managers and owners (the server checks `branch: ['pause']`). The
 * queue refreshes it with each refresh of the board, so another tablet's pause shows within 10
 * seconds.
 */
export function useBranchPause(branchId: MaybeRefOrGetter<string>) {
  const url = () => `/counter/${encodeURIComponent(toValue(branchId))}`
  const query = useApiQuery(() => `counter:pause:${toValue(branchId)}`, () => apiFetch<BranchPause>(`${url()}/pause`), { server: false })
  const pausedUntil = computed(() => query.data.value?.pausedUntil ?? null)

  const pause = useMutation(
    (input: PauseBranchInput) => apiFetch<BranchPause>(`${url()}/pause`, { method: 'POST', body: input }),
    {
      id: 'counter:pause',
      key: () => toValue(branchId),
      lock: () => `branch-pause:${toValue(branchId)}`,
      successMessage: (saved: BranchPause) => `Online orders paused until ${saved.pausedUntil ? formatTime(saved.pausedUntil) : 'later'}`,
      errorMessage: 'Could not pause online orders',
      onSuccess: (saved: BranchPause) => {
        query.data.value = saved
      },
      invalidate: ['counter'],
    },
  )

  // Takes the branch, so its pending state can be read per branch (`isPending(branchId)`).
  const resume = useMutation(
    (id: string) => apiFetch<BranchPause>(`/counter/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
    {
      id: 'counter:resume',
      key: id => id,
      lock: id => `branch-pause:${id}`,
      successMessage: 'Online orders are on again',
      errorMessage: 'Could not resume online orders',
      onSuccess: (saved: BranchPause) => {
        query.data.value = saved
      },
      invalidate: ['counter'],
    },
  )

  return { query, pausedUntil, pause, resume }
}
