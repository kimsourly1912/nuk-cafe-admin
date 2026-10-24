import type { BranchPause, BranchSettings, CreateBranchInput, CreateTableInput, DiningTable, UpdateBranchSettingsInput, UpdateTableInput } from '#shared/contracts/branches'

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
    (input: NewTable) => apiFetch<DiningTable>(tablesUrl(input.branchId, surface), { method: 'POST', body: { label: input.label, area: input.area } }),
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
