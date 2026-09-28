import type { OptionSet } from '#shared/contracts/menu-options'
import { useOptionSetList } from './useOptionSets'

/**
 * PUBLIC. Every option set with its values, archived ones included (an item may still use one),
 * for the menu-item form; `[]` until loaded. Shares the library page's query (`option-sets:list`),
 * so a change on either refreshes both once.
 */
export function useOptionSetOptions() {
  const query = useOptionSetList()
  return { ...query, data: computed<OptionSet[]>(() => query.data.value ?? []) }
}
