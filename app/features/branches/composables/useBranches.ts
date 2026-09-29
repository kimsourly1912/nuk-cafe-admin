import type { BranchSettings, CreateTableInput, DiningTable, UpdateBranchSettingsInput, UpdateTableInput } from '#shared/contracts/branches'
import type { BranchOption } from '#shared/contracts/staff'

const base = (branchId: string) => `/admin/branches/${branchId}`

/** Staff lists show branch names. */
const AFFECTED = ['branches', 'staff']

/** Active branches (the Branch page opens the only one, or lists them). */
export function useBranchOptions() {
  return useApiQuery('branches:options', () => apiFetch<BranchOption[]>('/admin/branches/options'))
}

/** A branch's settings and hours, with "open now" as the server saw it. */
export function useBranchSettings(branchId: string) {
  return useApiQuery(`branches:settings:${branchId}`, () => fetchBranchSettings(branchId))
}

/** Fresh settings (Reload after someone else saved). */
export const fetchBranchSettings = (branchId: string) => apiFetch<BranchSettings>(base(branchId))

/** Every table of the branch, active and archived: a branch has few, so the page filters them itself. */
export function useBranchTables(branchId: string) {
  return useApiQuery(`branches:tables:${branchId}`, () => apiFetch<DiningTable[]>(`${base(branchId)}/tables`, { query: { status: 'all' } }))
}

export interface BranchSettingsSave {
  branchId: string
  body: UpdateBranchSettingsInput
}

export function useBranchMutations() {
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
  return { update }
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
const tableUrl = (table: DiningTable, action = '') => `${base(table.branchId)}/tables/${table.id}${action}`

/** Table mutations; each resolves to the table as it now is. */
export function useTableMutations() {
  const create = useMutation(
    (input: NewTable) => apiFetch<DiningTable>(`${base(input.branchId)}/tables`, { method: 'POST', body: { label: input.label, area: input.area } }),
    {
      id: 'branches:table-create',
      key: input => `${input.branchId}:${input.label.toLowerCase()}`,
      successMessage: (_, input) => `Table "${input.label}" added`,
      errorMessage: input => `Could not add "${input.label}"`,
      invalidate: ['branches'],
    },
  )

  const update = useMutation(
    (input: TableEdit) => apiFetch<DiningTable>(tableUrl(input.table), { method: 'PATCH', body: { version: input.table.version, ...input.body } }),
    {
      id: 'branches:table-update',
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
      id: 'branches:table-archive',
      key: tableLock,
      lock: tableLock,
      confirm: input => ({
        title: `Archive "${input.table.label}"?`,
        description: 'Its QR code stops working until you restore the table.',
        confirmLabel: 'Archive',
      }),
      successMessage: (_, input) => `Table "${input.table.label}" archived`,
      errorMessage: input => `Could not archive "${input.table.label}"`,
      invalidate: ['branches'],
    },
  )

  const restore = useMutation(
    (input: TableChange) => apiFetch<DiningTable>(tableUrl(input.table, '/restore'), { method: 'POST', body: { version: input.table.version } }),
    {
      id: 'branches:table-restore',
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
      id: 'branches:table-rotate',
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

  const isBusy = (tableId: string) => [update, archive, restore, rotate].some(m => m.isPending(`dining-table:${tableId}`))

  return { create, update, archive, restore, rotate, isBusy }
}
