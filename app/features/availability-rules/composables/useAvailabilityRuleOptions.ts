import type { AvailabilityRule } from '#shared/contracts/menu-availability'

/**
 * PUBLIC. Every availability rule, archived ones included (a record may still use one, and its
 * name must show), for pickers.
 */
export function useAvailabilityRuleOptions() {
  return useApiQuery('availability-rules:options', () => apiFetch<AvailabilityRule[]>('/admin/menu/availability-rules', { query: { status: 'all' } }), { default: () => [] })
}
