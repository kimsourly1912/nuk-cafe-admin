import type { SoldOutList } from '#shared/contracts/menu-sold-out'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { soldOutRows } from '../utils/sold-out'
import type { SoldOutRow } from '../utils/sold-out'

/**
 * The Sold out page's data (step 6.3c, D105): the branch's menu as customers see it now (every
 * item and version it lists, each marked sold out or not, `GET /api/public/menu`), and who switched
 * each one off and when (`GET /api/counter/{branchId}/sold-out`). The switch sets a state (D64):
 * two people at once, or a retry, end in the state asked for, so it needs no version.
 *
 * A switch moves at once (D152): `toggle` shows the state asked for until the server answers, then
 * takes the server's list from the answer; a refusal puts the switch back and says why (a toast).
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
  /** Asked for and not answered yet, by version: shown at once. */
  const asked = ref<Record<string, boolean>>({})
  const rows = computed<SoldOutRow[] | null>(() => {
    if (!menu.data.value) return null
    return soldOutRows(menu.data.value, list.data.value ?? null).map(row => (row.variationId in asked.value
      ? { ...row, soldOut: asked.value[row.variationId]!, since: asked.value[row.variationId] ? row.since : null, by: asked.value[row.variationId] ? row.by : null }
      : row))
  })

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

  async function toggle(row: SoldOutRow, soldOut: boolean) {
    asked.value = { ...asked.value, [row.variationId]: soldOut }
    const result = await set.execute({ row, soldOut })
    if (result.ok) list.data.value = result.data
    asked.value = Object.fromEntries(Object.entries(asked.value).filter(([id]) => id !== row.variationId))
  }

  return { menu, list, rows, set, toggle, error: computed(() => menu.error.value ?? list.error.value), refresh: () => Promise.all([menu.refresh(), list.refresh()]) }
}
