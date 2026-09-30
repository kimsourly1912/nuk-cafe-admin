import type { SoldOutList } from '#shared/contracts/menu-sold-out'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { soldOutRows } from '../utils/sold-out'
import type { SoldOutRow } from '../utils/sold-out'

/**
 * The Sold out page's data (step 6.3c, D105): the branch's menu as customers see it now (every
 * item and version it lists, each marked sold out or not, `GET /api/public/menu`), and who switched
 * each one off and when (`GET /api/counter/{branchId}/sold-out`). The switch sets a state (D64):
 * two people at once, or a retry, end in the state asked for, so it needs no version.
 */
export function useSoldOut(branchId: MaybeRefOrGetter<string>) {
  const menu = useApiQuery(
    () => `counter:sold-out-menu:${toValue(branchId)}`,
    () => apiFetch<PublicMenu>('/public/menu', { query: { branchId: toValue(branchId) } }),
    { server: false },
  )
  const list = useApiQuery(
    () => `counter:sold-out:${toValue(branchId)}`,
    () => apiFetch<SoldOutList>(`/counter/${encodeURIComponent(toValue(branchId))}/sold-out`),
    { server: false },
  )
  const rows = computed<SoldOutRow[] | null>(() => (menu.data.value ? soldOutRows(menu.data.value, list.data.value ?? null) : null))

  const set = useMutation(
    (input: { row: SoldOutRow, soldOut: boolean }) => apiFetch<SoldOutList>(`/counter/${encodeURIComponent(toValue(branchId))}/sold-out`, {
      method: 'PUT',
      body: { variationIds: [input.row.variationId], soldOut: input.soldOut },
    }),
    {
      id: 'counter:sold-out',
      key: input => input.row.variationId,
      lock: input => `sold-out:${input.row.variationId}`,
      successMessage: false,
      errorMessage: input => `Couldn't mark ${input.row.label ? `${input.row.itemName} · ${input.row.label}` : input.row.itemName} ${input.soldOut ? 'sold out' : 'available'}`,
      // The queue and this page (both `counter:`); the customer menu reads the server on its next load.
      invalidate: ['counter'],
    },
  )

  return { menu, list, rows, set, error: computed(() => menu.error.value ?? list.error.value), refresh: () => Promise.all([menu.refresh(), list.refresh()]) }
}
