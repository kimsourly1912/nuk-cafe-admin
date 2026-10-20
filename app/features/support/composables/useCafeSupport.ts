import type { CafeSupport, SupportVisit } from '#shared/contracts/support'

/** Support access in the cafe's admin (P5, D193): the owner's grant and who looked. */

export function useCafeSupport() {
  return useApiQuery('support:cafe', () => apiFetch<CafeSupport>('/admin/support'))
}

export function useCafeSupportMutations() {
  const allow = useMutation(
    (_input: Record<string, never>) => apiFetch<CafeSupport>('/admin/support', { method: 'POST' }),
    {
      id: 'support:allow',
      key: () => 'support',
      confirm: () => ({
        title: 'Allow platform support for 24 hours?',
        description: 'The platform team can look at this cafe\'s admin, read-only: the menu, orders, reports, staff and settings. They can\'t change anything. You can end it at any time.',
        confirmLabel: 'Allow for 24 hours',
      }),
      successMessage: () => 'Platform support is allowed for 24 hours',
      errorMessage: () => 'Could not allow platform support',
      invalidate: ['support'],
    },
  )

  const end = useMutation(
    (grantId: string) => apiFetch<CafeSupport>(`/admin/support/${grantId}/end`, { method: 'POST' }),
    {
      id: 'support:end',
      key: () => 'support',
      confirm: () => ({
        title: 'End platform support now?',
        description: 'Anyone from the platform team looking at this cafe is shut out at once.',
        confirmLabel: 'End now',
      }),
      successMessage: () => 'Platform support has ended',
      errorMessage: () => 'Could not end platform support',
      invalidate: ['support'],
    },
  )

  const endVisit = useMutation(
    (visit: SupportVisit) => apiFetch<CafeSupport>(`/admin/support/visits/${visit.id}/end`, { method: 'POST' }),
    {
      id: 'support:end-visit',
      key: visit => visit.id,
      confirm: () => ({
        title: 'End this visit now?',
        description: 'This person is shut out at once. Platform support stays allowed: they can open the cafe again with a fresh code. End platform support to stop that too.',
        confirmLabel: 'End visit',
      }),
      successMessage: () => 'The visit has ended',
      errorMessage: () => 'Could not end the visit',
      invalidate: ['support'],
    },
  )

  return { allow, end, endVisit, busy: computed(() => allow.isPending() || end.isPending()) }
}
