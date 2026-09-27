import type { Page } from '#shared/contracts/common'
import type { BranchOption, CreatedStaff, CreateStaffInput, StaffListQuery, StaffMember, UpdateStaffAccessInput } from '#shared/contracts/staff'

export type { StaffListQuery }

/** Updating and disabling one person must never overlap: both take this record lock. */
const lockOf = (id: string) => `staff:${id}`

/** Paginated staff list (people with access). Refetches whenever `query` changes. */
export function useStaffList(query: MaybeRefOrGetter<Partial<StaffListQuery>>) {
  return useApiQuery('staff:list', () => apiFetch<Page<StaffMember>>('/admin/staff', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** Active branches for the membership pickers. */
export function useBranchOptions() {
  return useApiQuery('staff:branch-options', () => apiFetch<BranchOption[]>('/admin/branches/options'))
}

/**
 * Staff mutations. State is shared app-wide by mutation id, so a row knows it's being saved even
 * after the form that started it was closed.
 */
export function useStaffMutations() {
  const create = useMutation(
    (body: CreateStaffInput) => apiFetch<CreatedStaff>('/admin/staff', { method: 'POST', body }),
    {
      id: 'staff:create',
      // Same email in flight = the same submission (double submit).
      key: body => body.email,
      successMessage: (created, body) => created.temporaryPassword
        ? `Account for ${body.name} created`
        : `${created.staff.name} already had an account and now has staff access`,
      errorMessage: body => `Could not add ${body.email}`,
      invalidate: ['staff'],
    },
  )

  const updateAccess = useMutation(
    ({ member, body }: { member: StaffMember, body: UpdateStaffAccessInput }) =>
      apiFetch<StaffMember>(`/admin/staff/${member.id}`, { method: 'PATCH', body }),
    {
      id: 'staff:update-access',
      key: ({ member }) => member.id,
      lock: ({ member }) => lockOf(member.id),
      successMessage: (_, { member }) => `Access of ${member.name} updated`,
      errorMessage: ({ member }) => `Could not update ${member.name}`,
      invalidate: ['staff'],
    },
  )

  const disable = useMutation(
    (member: StaffMember) => apiFetch<null>(`/admin/staff/${member.id}/disable`, { method: 'POST', body: { version: member.version } }),
    {
      id: 'staff:disable',
      key: member => member.id,
      lock: member => lockOf(member.id),
      removes: true,
      confirm: member => ({
        title: `Disable ${member.name}?`,
        description: 'They lose admin and branch access and are signed out everywhere. Their account keeps working as a customer, and you can give them access again later.',
        confirmLabel: 'Disable',
        danger: true,
      }),
      successMessage: (_, member) => `${member.name} no longer has staff access`,
      errorMessage: member => `Could not disable ${member.name}`,
      invalidate: ['staff'],
    },
  )

  return {
    create,
    updateAccess,
    disable,
    /** Any operation in flight for this person: disable their row actions. */
    isBusy: (id: string) => updateAccess.isPending(id) || disable.isPending(id),
  }
}
