import type { BranchPause, BranchSettings, CreateBranchInput, CreateTableInput, DiningTable, UpdateBranchSettingsInput, UpdateTableInput } from '#shared/contracts/branches'
import type { BranchLayout, CreateItemLookInput, CreateLookInput, CustomItemLook, CustomLook, LayoutHistoryEntry, SaveLayoutInput, ShopLayout, UpdateItemLookInput } from '#shared/contracts/shop-layout'

const base = (branchId: string) => `/admin/branches/${branchId}`

/** Staff lists show branch names. */
const AFFECTED = ['branches', 'staff']

/** A branch's settings and hours, with "open now" as the server saw it. */
export function useBranchSettings(branchId: string) {
  return useApiQuery(`branches:settings:${branchId}`, () => fetchBranchSettings(branchId))
}

/** Fresh settings (Reload after someone else saved). */
export const fetchBranchSettings = (branchId: string) => apiFetch<BranchSettings>(base(branchId))

/**
 * Where tables are managed (D198): the admin's Branch page, or a manager's counter, on its own API
 * (`table: ['manage']` there). The same tables either way, so they share the cache.
 */
export type TablesSurface = 'admin' | 'counter'

const tablesUrl = (branchId: string, surface: TablesSurface) =>
  surface === 'counter' ? `/counter/${branchId}/tables` : `${base(branchId)}/tables`

/** Every table of the branch, active and archived: a branch has few, so the page filters them itself. */
export function useBranchTables(branchId: string, surface: TablesSurface = 'admin') {
  return useApiQuery(`branches:tables:${branchId}`, () => apiFetch<DiningTable[]>(tablesUrl(branchId, surface), { query: { status: 'all' } }))
}

export interface BranchSettingsSave {
  branchId: string
  body: UpdateBranchSettingsInput
}

export function useBranchMutations() {
  const create = useMutation(
    (input: CreateBranchInput) => apiFetch<BranchSettings>('/admin/branches', { method: 'POST', body: input }),
    {
      id: 'branches:create',
      key: input => input.name.toLowerCase(),
      successMessage: (branch: BranchSettings) => `Branch "${branch.name}" added`,
      errorMessage: input => `Could not add "${input.name}"`,
      invalidate: AFFECTED,
    },
  )

  const update = useMutation(
    (input: BranchSettingsSave) => apiFetch<BranchSettings>(base(input.branchId), { method: 'PATCH', body: input.body }),
    {
      id: 'branches:update',
      key: input => input.branchId,
      lock: input => `branch:${input.branchId}`,
      successMessage: 'Branch settings saved',
      errorMessage: 'Could not save the branch settings',
      invalidate: AFFECTED,
    },
  )
  // Pausing is the counter's (D199); an owner may end a pause from the Branch page.
  const resume = useMutation(
    (branchId: string) => apiFetch<BranchPause>(`${base(branchId)}/resume`, { method: 'POST' }),
    {
      id: 'branches:resume',
      key: branchId => branchId,
      lock: branchId => `branch-pause:${branchId}`,
      successMessage: 'Online orders are on again',
      errorMessage: 'Could not resume online orders',
      invalidate: ['branches'],
    },
  )
  return { create, update, resume }
}

export interface NewTable extends CreateTableInput {
  branchId: string
}
export interface TableChange {
  table: DiningTable
}
export interface TableEdit extends TableChange {
  body: Omit<UpdateTableInput, 'version'>
}

const tableLock = (change: TableChange) => `dining-table:${change.table.id}`

/** Table mutations on the admin's or the counter's API; each resolves to the table as it now is. */
export function useTableMutations(surface: TablesSurface = 'admin') {
  const tableUrl = (table: DiningTable, action = '') => `${tablesUrl(table.branchId, surface)}/${table.id}${action}`
  const create = useMutation(
    (input: NewTable) => apiFetch<DiningTable>(tablesUrl(input.branchId, surface), { method: 'POST', body: { label: input.label, area: input.area, seats: input.seats } }),
    {
      id: `branches:${surface}:table-create`,
      key: input => `${input.branchId}:${input.label.toLowerCase()}`,
      successMessage: (_, input) => `Table "${input.label}" added`,
      errorMessage: input => `Could not add "${input.label}"`,
      invalidate: ['branches'],
    },
  )

  const update = useMutation(
    (input: TableEdit) => apiFetch<DiningTable>(tableUrl(input.table), { method: 'PATCH', body: { version: input.table.version, ...input.body } }),
    {
      id: `branches:${surface}:table-update`,
      key: tableLock,
      lock: tableLock,
      successMessage: (table: DiningTable) => `Table "${table.label}" saved`,
      errorMessage: input => `Could not save "${input.table.label}"`,
      invalidate: ['branches'],
    },
  )

  const archive = useMutation(
    (input: TableChange) => apiFetch<DiningTable>(tableUrl(input.table, '/archive'), { method: 'POST', body: { version: input.table.version } }),
    {
      id: `branches:${surface}:table-archive`,
      key: tableLock,
      lock: tableLock,
      // Undo instead of asking (D152): the same QR code works again.
      undo: ([done]) => void (done && restore.execute({ ...done.input, table: done.data })),
      successMessage: (_, input) => `Table "${input.table.label}" archived · its QR code stops working until it's restored`,
      errorMessage: input => `Could not archive "${input.table.label}"`,
      invalidate: ['branches'],
    },
  )

  const restore = useMutation(
    (input: TableChange) => apiFetch<DiningTable>(tableUrl(input.table, '/restore'), { method: 'POST', body: { version: input.table.version } }),
    {
      id: `branches:${surface}:table-restore`,
      key: tableLock,
      lock: tableLock,
      successMessage: (_, input) => `Table "${input.table.label}" restored`,
      errorMessage: input => `Could not restore "${input.table.label}"`,
      invalidate: ['branches'],
    },
  )

  const rotate = useMutation(
    (input: TableChange) => apiFetch<DiningTable>(tableUrl(input.table, '/rotate-qr'), { method: 'POST', body: { version: input.table.version } }),
    {
      id: `branches:${surface}:table-rotate`,
      key: tableLock,
      lock: tableLock,
      confirm: input => ({
        title: `Give "${input.table.label}" a new QR code?`,
        description: 'The printed QR code stops working at once. Print the new one and replace it on the table.',
        confirmLabel: 'New QR code',
        danger: true,
      }),
      successMessage: (_, input) => `New QR code for "${input.table.label}"`,
      errorMessage: input => `Could not change the QR code of "${input.table.label}"`,
      invalidate: ['branches'],
    },
  )

  /**
   * Deletes an archived table no order was placed at for good (D200). Owners only: the admin's
   * API has it, the counter's doesn't. The server refuses a table with orders (409 `TABLE_HAS_ORDERS`).
   */
  const remove = useMutation(
    (input: TableChange) => apiFetch<null>(tableUrl(input.table), { method: 'DELETE', query: { version: input.table.version } }),
    {
      id: `branches:${surface}:table-delete`,
      key: tableLock,
      lock: tableLock,
      removes: true,
      confirm: input => ({
        title: `Delete "${input.table.label}" permanently?`,
        description: 'No order was placed at it. Its QR code never works again, and it can\'t be restored.',
        confirmLabel: 'Delete permanently',
        danger: true,
      }),
      successMessage: (_, input) => `Table "${input.table.label}" deleted`,
      errorMessage: input => `Could not delete "${input.table.label}"`,
      invalidate: ['branches'],
    },
  )

  const isBusy = (tableId: string) => [update, archive, restore, rotate, remove].some(m => m.isPending(`dining-table:${tableId}`))
  /** Deleted: hidden until the refetch arrives. */
  const isRemoved = (tableId: string) => remove.isRemoved(`dining-table:${tableId}`)

  return { create, update, archive, restore, rotate, remove, isBusy, isRemoved }
}

/**
 * A branch's shop layout (D273) and its active tables, on the admin's API. Table changes invalidate
 * `branches`, so an archived table leaves the layout's list here too.
 */
export function useBranchLayout(branchId: string, options: { immediate?: boolean } = {}) {
  return useApiQuery(`branches:layout:${branchId}`, () => fetchBranchLayout(branchId), options)
}

/** The layout as saved now (the stale-save flow reads it without touching the editor's draft). */
export const fetchBranchLayout = (branchId: string) => apiFetch<BranchLayout>(`${base(branchId)}/layout`)

/** The layout's version history (ISS-027), newest first; read when the History panel opens. */
export function useLayoutHistory(branchId: string) {
  return useApiQuery(`branches:layout-history:${branchId}`, () => apiFetch<LayoutHistoryEntry[]>(`${base(branchId)}/layout/history`), { immediate: false })
}

/** One version's layout, to restore in the editor. */
export const fetchLayoutVersion = (branchId: string, version: number) => apiFetch<ShopLayout>(`${base(branchId)}/layout/history/${version}`)

export interface LayoutSave {
  branchId: string
  body: SaveLayoutInput
  /** An autosave (ISS-027): no success toast, the status says it. */
  quiet?: boolean
}

/** Saves the whole layout as one versioned change; resolves to the layout as saved. */
export function useLayoutMutations() {
  const save = useMutation(
    (input: LayoutSave) => apiFetch<BranchLayout>(`${base(input.branchId)}/layout`, { method: 'PUT', body: input.body }),
    {
      id: 'branches:layout-save',
      key: input => input.branchId,
      lock: input => `branch-layout:${input.branchId}`,
      successMessage: (_, input) => (input.quiet ? false : 'Shop layout saved'),
      errorMessage: 'Could not save the shop layout',
    },
  )
  return { save }
}

/**
 * The cafe's own table looks (D273, step 3a), for every branch: `branches:looks`. A look's change
 * invalidates `branches`, so open layouts and this list follow.
 */
export function useLooks(options: { immediate?: boolean } = {}) {
  return useApiQuery('branches:looks', () => apiFetch<CustomLook[]>('/admin/furniture-looks'), options)
}

const lookLock = (input: { look: CustomLook }) => `furniture-look:${input.look.id}`

export function useLookMutations() {
  const create = useMutation(
    (input: CreateLookInput) => apiFetch<CustomLook>('/admin/furniture-looks', { method: 'POST', body: input }),
    {
      id: 'branches:look-create',
      key: input => input.name.toLowerCase(),
      successMessage: look => `Look "${look.name}" saved`,
      errorMessage: input => `Could not save "${input.name}"`,
      invalidate: ['branches'],
    },
  )

  const update = useMutation(
    (input: { look: CustomLook, body: CreateLookInput }) => apiFetch<CustomLook>(`/admin/furniture-looks/${input.look.id}`, { method: 'PATCH', body: { version: input.look.version, ...input.body } }),
    {
      id: 'branches:look-update',
      key: lookLock,
      lock: lookLock,
      successMessage: look => `Look "${look.name}" saved`,
      errorMessage: input => `Could not save "${input.look.name}"`,
      invalidate: ['branches'],
    },
  )

  /** Deletes a look no placed table uses; the server refuses one in use and names its tables (409 `LOOK_IN_USE`). */
  const remove = useMutation(
    (input: { look: CustomLook }) => apiFetch<null>(`/admin/furniture-looks/${input.look.id}`, { method: 'DELETE', query: { version: input.look.version } }),
    {
      id: 'branches:look-delete',
      key: lookLock,
      lock: lookLock,
      confirm: input => ({
        title: `Delete the look "${input.look.name}"?`,
        description: 'No table uses it. It can\'t be restored.',
        confirmLabel: 'Delete look',
        danger: true,
      }),
      successMessage: (_, input) => `Look "${input.look.name}" deleted`,
      errorMessage: input => `Could not delete "${input.look.name}"`,
      invalidate: ['branches'],
    },
  )

  return { create, update, remove }
}

/**
 * The cafe's own chair and fixture looks (D273, step 3d), for every branch: `branches:item-looks`.
 * A change invalidates `branches`, so open layouts and this list follow.
 */
export function useItemLooks(options: { immediate?: boolean } = {}) {
  return useApiQuery('branches:item-looks', () => apiFetch<CustomItemLook[]>('/admin/item-looks'), options)
}

const itemLookLock = (input: { look: CustomItemLook }) => `furniture-item-look:${input.look.id}`

export function useItemLookMutations() {
  const create = useMutation(
    (input: CreateItemLookInput) => apiFetch<CustomItemLook>('/admin/item-looks', { method: 'POST', body: input }),
    {
      id: 'branches:item-look-create',
      key: input => input.name.toLowerCase(),
      successMessage: look => `Look "${look.name}" saved`,
      errorMessage: input => `Could not save "${input.name}"`,
      invalidate: ['branches'],
    },
  )

  /** The whole look again, without its kind (a look's kind never changes). */
  const update = useMutation(
    (input: { look: CustomItemLook, body: Omit<UpdateItemLookInput, 'version'> }) => apiFetch<CustomItemLook>(`/admin/item-looks/${input.look.id}`, { method: 'PATCH', body: { version: input.look.version, ...input.body } }),
    {
      id: 'branches:item-look-update',
      key: itemLookLock,
      lock: itemLookLock,
      successMessage: look => `Look "${look.name}" saved`,
      errorMessage: input => `Could not save "${input.look.name}"`,
      invalidate: ['branches'],
    },
  )

  /** Deletes a look no placed piece uses; the server refuses one in use and names its floors (409 `LOOK_IN_USE`). */
  const remove = useMutation(
    (input: { look: CustomItemLook }) => apiFetch<null>(`/admin/item-looks/${input.look.id}`, { method: 'DELETE', query: { version: input.look.version } }),
    {
      id: 'branches:item-look-delete',
      key: itemLookLock,
      lock: itemLookLock,
      confirm: input => ({
        title: `Delete the look "${input.look.name}"?`,
        description: 'No piece of furniture uses it. It can\'t be restored.',
        confirmLabel: 'Delete look',
        danger: true,
      }),
      successMessage: (_, input) => `Look "${input.look.name}" deleted`,
      errorMessage: input => `Could not delete "${input.look.name}"`,
      invalidate: ['branches'],
    },
  )

  return { create, update, remove }
}
