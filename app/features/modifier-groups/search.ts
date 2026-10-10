import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { AdminSearchSource } from '~/types/admin-search'
import { ADMIN_SEARCH_LIMIT, matchesSearch } from '~/types/admin-search'

/** Add-on groups in the admin's search (D152), by the group's name or an add-on's: the group's own page. */
export const modifierGroupsSearch: AdminSearchSource = {
  id: 'modifier-groups',
  label: 'Add-ons',
  async search(term) {
    const all = await apiFetch<ModifierGroup[]>('/admin/menu/modifier-groups', { query: { status: 'all' } })
    return all.filter(group => matchesSearch(group.name, term) || group.modifiers.some(addOn => matchesSearch(addOn.name, term)))
      .slice(0, ADMIN_SEARCH_LIMIT)
      .map(group => ({
        id: group.id,
        label: group.name,
        suffix: group.status === 'archived' ? 'Archived' : undefined,
        icon: 'i-lucide-circle-plus',
        page: `/admin/add-ons/${group.id}`,
      }))
  },
}
