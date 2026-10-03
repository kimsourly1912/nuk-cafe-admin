import type { CafeSettings, UpdateCafeInput } from '#shared/contracts/cafe'

/** The cafe's own profile for its owners (`/api/c/<slug>/admin/cafe`, D143). */
export function useCafeSettings() {
  return useApiQuery('cafe:settings', fetchCafeSettings)
}

/** The latest saved profile, for Reload after someone else's save. */
export function fetchCafeSettings() {
  return apiFetch<CafeSettings>('/admin/cafe')
}

export function useCafeMutations() {
  const save = useMutation(
    (input: UpdateCafeInput) => apiFetch<CafeSettings>('/admin/cafe', { method: 'PATCH', body: input }),
    {
      id: 'cafe:save',
      lock: () => 'cafe',
      successMessage: 'Cafe profile saved',
      errorMessage: 'Could not save the cafe profile',
      // `cafe` also refreshes the name and logo the sidebar, menu and counter show (`useCafe`).
      invalidate: ['cafe'],
    },
  )
  return { save }
}
