import { createSharedComposable, useLocalStorage, useSessionStorage } from '@vueuse/core'
import type { PublicBranch, PublicTable } from '#shared/contracts/branches'
import type { PublicMenu } from '#shared/contracts/public-menu'
import type { CartLine } from '../utils/cart'
import { addLine, parseLines, setLineQuantity } from '../utils/cart'

/**
 * The customer site's state (D93): which branch's menu, the table a QR code named, the menu, and the
 * order before checkout. Reads go through `useApiQuery` (the menu refreshes when the customer comes
 * back to the tab, so sold-out switches show). The table and the order live in this browser only:
 * the table for this tab's visit (session storage), the order across visits (local storage).
 */

/** A dine-in table from a scanned QR code (`/table/<token>`), for this tab's visit. */
export interface TableContext {
  branchId: string
  tableId: string
  label: string
}

// Browser storage can be unavailable (private windows, blocked site data): VueUse falls back to the
// default and reports the failure without throwing.
const useStoredTable = createSharedComposable(() => useSessionStorage<TableContext | null>('nuk-cafe:table', null, {
  serializer: {
    read: (raw) => {
      try {
        const value = JSON.parse(raw) as Partial<TableContext> | null
        return value && typeof value.branchId === 'string' && typeof value.tableId === 'string' && typeof value.label === 'string'
          ? { branchId: value.branchId, tableId: value.tableId, label: value.label }
          : null
      }
      catch {
        return null
      }
    },
    write: value => JSON.stringify(value),
  },
}))

export function useTableContext() {
  const table = useStoredTable()
  return {
    table: readonly(table),
    setTable: (scanned: PublicTable) => {
      table.value = { branchId: scanned.branch.id, tableId: scanned.table.id, label: scanned.table.label }
    },
    clearTable: () => {
      table.value = null
    },
  }
}

/** The branch the customer picked (only offered when there are several), across visits. */
const useChosenBranch = createSharedComposable(() => useLocalStorage<string | null>('nuk-cafe:branch', null))

/** The active branches, whether each is open, and which one's menu is shown. */
export function useShopBranch() {
  const { table } = useTableContext()
  const chosen = useChosenBranch()
  const query = useApiQuery('menu:branches', () => apiFetch<PublicBranch[]>('/public/branches'))
  const branches = computed(() => query.data.value ?? [])
  /** A table's branch first, then the customer's pick while it's still active, then the first. */
  const branchId = computed(() => {
    const ids = branches.value.map(b => b.id)
    if (table.value && ids.includes(table.value.branchId)) return table.value.branchId
    if (chosen.value && ids.includes(chosen.value)) return chosen.value
    return ids[0]
  })
  return {
    ...query,
    branches,
    branchId,
    choose: (id: string) => {
      chosen.value = id
    },
  }
}

/** What the branch sells now, with its open status (`GET /api/public/menu`). */
export function usePublicMenu(branchId: Ref<string | undefined>) {
  return useApiQuery(
    () => `menu:public:${branchId.value ?? 'none'}`,
    () => (branchId.value ? apiFetch<PublicMenu>('/public/menu', { query: { branchId: branchId.value } }) : Promise.resolve(null)),
  )
}

/** Every branch's order, by branch id (a branch's menu decides what its lines mean). */
const useStoredCarts = createSharedComposable(() => useLocalStorage<Record<string, CartLine[]>>('nuk-cafe:cart', {}, {
  serializer: {
    read: (raw) => {
      try {
        const value = JSON.parse(raw) as Record<string, unknown>
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        return Object.fromEntries(Object.entries(value).map(([branch, lines]) => [branch, parseLines(lines)]))
      }
      catch {
        return {}
      }
    },
    write: value => JSON.stringify(value),
  },
}))

/** The order for one branch: add, change a quantity (0 removes), empty. */
export function useCart(branchId: Ref<string | undefined>) {
  const carts = useStoredCarts()
  const lines = computed(() => (branchId.value ? carts.value[branchId.value] ?? [] : []))
  function update(next: CartLine[]) {
    if (!branchId.value) return
    carts.value = { ...carts.value, [branchId.value]: next }
  }
  return {
    lines,
    add: (line: Omit<CartLine, 'key'>) => update(addLine(lines.value, line)),
    setQuantity: (key: string, quantity: number) => update(setLineQuantity(lines.value, key, quantity)),
  }
}
