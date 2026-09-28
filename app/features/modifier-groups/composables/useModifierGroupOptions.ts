import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { useModifierGroupList } from './useModifierGroups'

/**
 * PUBLIC. Every add-on group with its add-ons, archived ones included (an item may still offer
 * one), for the menu-item form; `[]` until loaded. Shares the library page's query
 * (`modifier-groups:list`), so a change on either refreshes both once.
 */
export function useModifierGroupOptions() {
  const query = useModifierGroupList()
  return { ...query, data: computed<ModifierGroup[]>(() => query.data.value ?? []) }
}
