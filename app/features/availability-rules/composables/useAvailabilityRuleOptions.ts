import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import { useAvailabilityRuleList } from './useAvailabilityRules'

/**
 * PUBLIC. Every availability rule, archived ones included (a record may still use one, and its
 * name must show), for pickers; `[]` until loaded. Shares the library page's query
 * (`availability-rules:list`), so a change on either refreshes both once.
 */
export function useAvailabilityRuleOptions() {
  const query = useAvailabilityRuleList()
  return { ...query, data: computed<AvailabilityRule[]>(() => query.data.value ?? []) }
}
