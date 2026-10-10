import type { OptionSet } from '#shared/contracts/menu-options'
import type { AdminSearchSource } from '~/types/admin-search'
import { ADMIN_SEARCH_LIMIT, matchesSearch } from '~/types/admin-search'

/** Option sets in the admin's search (D152), by the set's name or a value's: the Options page searching for it. */
export const optionSetsSearch: AdminSearchSource = {
  id: 'option-sets',
  label: 'Options',
  async search(term) {
    const all = await apiFetch<OptionSet[]>('/admin/menu/option-sets', { query: { status: 'all' } })
    return all.filter(set => matchesSearch(set.name, term) || set.values.some(value => matchesSearch(value.name, term)))
      .slice(0, ADMIN_SEARCH_LIMIT)
      .map(set => ({
        id: set.id,
        label: set.name,
        suffix: [set.values.filter(value => value.status === 'active').map(value => value.name).join(', '), set.status === 'archived' ? 'Archived' : ''].filter(Boolean).join(' · '),
        icon: 'i-lucide-list-tree',
        page: `/admin/options?search=${encodeURIComponent(set.name)}&status=all`,
      }))
  },
}
