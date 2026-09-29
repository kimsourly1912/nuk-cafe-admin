import { createSharedComposable, useLocalStorage, useSessionStorage } from '@vueuse/core'
import type { PublicBranch, PublicTable } from '#shared/contracts/branches'
import { ORDER_MAX_LINES } from '#shared/contracts/orders'
import type { PublicMenu } from '#shared/contracts/public-menu'
import type { CartLine } from '../utils/cart'
import { addLine, canAddLine, parseLines, setLineNote, setLineQuantity } from '../utils/cart'

/**
 * The customer site's state (D93): which branch's menu, the table a QR code named, the menu, and the
 * order before checkout. Reads go through `useApiQuery` (the menu refreshes when the customer comes
 * back to the tab, so sold-out switches show). The table and the order live in this browser only:
 * the table for this tab's visit (session storage), the order across visits (local storage).
 *
 * Server rendering (D95): the server can't see browser storage, so every stored value is read once
 * the page is mounted (`initOnMounted`). The server and the browser's first render then agree (the
 * default branch, no table, an empty order), and the stored values apply right after.
 */

/** A dine-in table from a scanned QR code (`/table/<token>`), for this tab's visit. */
export interface TableContext {
  branchId: string
  tableId: string
  label: string
  /** The QR token: placing a dine-in order names the table by it (D99). */
  token: string
}

// Browser storage can be unavailable (private windows, blocked site data): VueUse falls back to the
// default and reports the failure without throwing.
const useStoredTable = createSharedComposable(() => useSessionStorage<TableContext | null>('nuk-cafe:table', null, {
  initOnMounted: true,
  serializer: {
    read: (raw) => {
      try {
        const value = JSON.parse(raw) as Partial<TableContext> | null
        return value && typeof value.branchId === 'string' && typeof value.tableId === 'string' && typeof value.label === 'string' && typeof value.token === 'string'
          ? { branchId: value.branchId, tableId: value.tableId, label: value.label, token: value.token }
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
    setTable: (scanned: PublicTable, token: string) => {
      table.value = { branchId: scanned.branch.id, tableId: scanned.table.id, label: scanned.table.label, token }
    },
    clearTable: () => {
      table.value = null
    },
  }
}

/** The branch the customer picked (only offered when there are several), across visits. */
const useChosenBranch = createSharedComposable(() => useLocalStorage<string | null>('nuk-cafe:branch', null, { initOnMounted: true }))

/** The active branches, whether each is open, and which one's menu is asked for. */
export function useShopBranch() {
  const { table } = useTableContext()
  const chosen = useChosenBranch()
  const query = useApiQuery('menu:branches', () => apiFetch<PublicBranch[]>('/public/branches'))
  const branches = computed(() => query.data.value ?? [])
  /**
   * A table's branch first, then the customer's pick while it's still active; otherwise none, and
   * the server serves its first branch (the same on the server and in the browser, D95).
   */
  const requestedBranchId = computed(() => {
    const ids = branches.value.map(b => b.id)
    if (table.value && ids.includes(table.value.branchId)) return table.value.branchId
    if (chosen.value && ids.includes(chosen.value)) return chosen.value
    return undefined
  })
  return {
    ...query,
    branches,
    requestedBranchId,
    choose: (id: string) => {
      chosen.value = id
    },
  }
}

/** What the branch sells now, with its open status (`GET /api/public/menu`); the server's first branch without one. */
export function usePublicMenu(branchId: Ref<string | undefined>) {
  return useApiQuery(
    () => `menu:public:${branchId.value ?? 'default'}`,
    () => apiFetch<PublicMenu>('/public/menu', { query: branchId.value ? { branchId: branchId.value } : {} }),
  )
}

/** Every branch's order, by branch id (a branch's menu decides what its lines mean). */
const useStoredCarts = createSharedComposable(() => useLocalStorage<Record<string, CartLine[]>>('nuk-cafe:cart', {}, {
  initOnMounted: true,
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
  const toast = useToast()
  return {
    lines,
    add: (line: Omit<CartLine, 'key'>) => {
      if (!canAddLine(lines.value, line)) {
        toast.add({ title: 'Your order is full', description: `An order can have up to ${ORDER_MAX_LINES} different items. Place this one first.`, color: 'warning', icon: 'i-lucide-triangle-alert' })
        return
      }
      update(addLine(lines.value, line))
    },
    setQuantity: (key: string, quantity: number) => update(setLineQuantity(lines.value, key, quantity)),
    setNote: (key: string, note: string) => update(setLineNote(lines.value, key, note)),
    /** After the order is placed. */
    clear: () => update([]),
  }
}
