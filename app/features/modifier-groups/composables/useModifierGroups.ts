import type { Page } from '#shared/contracts/common'
import type { MenuItemSummary } from '#shared/contracts/menu-items'
import type { CreateModifierGroupInput, Modifier, ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { ConfirmOptions } from '~/utils/mutation'

const BASE = '/admin/menu/modifier-groups'

/** Features whose data shows add-on names or prices (the menu-item form). */
const AFFECTED = ['modifier-groups', 'products']

/**
 * Every change to a group (its add-ons included) moves the group's one `version` (D59), so they
 * run one at a time: they share this key and lock, like option sets (D67).
 */
const groupKey = (groupId: string) => `modifier-group:${groupId}`

/** Every group, active and archived: the library is small, so the page filters and counts itself. */
export function useModifierGroupList() {
  return useApiQuery('modifier-groups:list', () => apiFetch<ModifierGroup[]>(BASE, { query: { status: 'all' } }))
}

/** One group, fresh from the server (the page's Reload after someone else changed it). */
export const fetchModifierGroup = (id: string) => apiFetch<ModifierGroup>(`${BASE}/${id}`)

/** One group, for its page. Refreshed with the feature (`modifier-groups:*`). */
export function useModifierGroup(id: string) {
  return useApiQuery(`modifier-groups:group:${id}`, () => fetchModifierGroup(id))
}

/** How many menu items the page lists by name; "View all" opens the rest on the Menu items page. */
export const USAGE_PREVIEW = 5

/**
 * The first menu items that offer the group (drafts and published, like `itemCount`), for the
 * page's "Used by" list. Product changes refresh it too (they invalidate `modifier-groups`).
 */
export function useModifierGroupItems(id: string) {
  return useApiQuery(`modifier-groups:items:${id}`, () => apiFetch<Page<MenuItemSummary>>('/admin/menu/items', { query: { modifierGroupId: id, pageSize: USAGE_PREVIEW } }))
}

export const activeModifiers = (group: ModifierGroup) => group.modifiers.filter(m => m.status === 'active')
export const archivedModifiers = (group: ModifierGroup) => group.modifiers.filter(m => m.status === 'archived')

interface GroupChange {
  group: ModifierGroup
}
interface ModifierChange extends GroupChange {
  modifier: Modifier
}
export type ModifierFields = Partial<Pick<Modifier, 'name' | 'priceDeltaMinor' | 'isDefault'>>

/**
 * Add-on group mutations. Each resolves to the whole group as it now is, so the editor can replace
 * its copy and send the new version with the next change.
 */
export function useModifierGroupMutations() {
  const create = useMutation(
    (body: CreateModifierGroupInput) => apiFetch<ModifierGroup>(BASE, { method: 'POST', body }),
    {
      id: 'modifier-groups:create',
      key: body => body.name.toLowerCase(),
      successMessage: (_, body) => `Add-on group "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  /** One change to a group: shared key, lock and refresh. */
  function change<T extends GroupChange>(id: string, request: (input: T) => Promise<ModifierGroup>, messages: { success: (input: T) => string, error: (input: T) => string, confirm?: (input: T) => ConfirmOptions }) {
    return useMutation(request, {
      id: `modifier-groups:${id}`,
      key: input => groupKey(input.group.id),
      lock: input => groupKey(input.group.id),
      confirm: messages.confirm,
      successMessage: (_, input) => messages.success(input),
      errorMessage: messages.error,
      invalidate: AFFECTED,
    })
  }

  const update = change(
    'update',
    ({ group, changes }: GroupChange & { changes: { name?: string, minSelect?: number, maxSelect?: number | null } }) =>
      apiFetch<ModifierGroup>(`${BASE}/${group.id}`, { method: 'PATCH', body: { version: group.version, ...changes } }),
    { success: ({ group, changes }) => `"${changes.name ?? group.name}" saved`, error: ({ group }) => `Could not save "${group.name}"` },
  )

  const archive = useMutation(
    ({ group }: GroupChange) => apiFetch<ModifierGroup>(`${BASE}/${group.id}/archive`, { method: 'POST', body: { version: group.version } }),
    {
      id: 'modifier-groups:archive',
      key: ({ group }) => groupKey(group.id),
      lock: ({ group }) => groupKey(group.id),
      confirm: ({ group }) => ({
        title: `Archive “${group.name}”?`,
        description: group.itemCount
          ? `${pluralize(group.itemCount, ['menu item offers', 'menu items offer'])} this group and will keep offering it, but it can't be added to other items until restored.`
          : 'This group can\'t be added to menu items until restored.',
        confirmLabel: 'Archive group',
      }),
      successMessage: (_, { group }) => `Add-on group "${group.name}" archived`,
      errorMessage: ({ group }) => `Could not archive "${group.name}"`,
      invalidate: AFFECTED,
    },
  )

  const restore = change(
    'restore',
    ({ group }: GroupChange) => apiFetch<ModifierGroup>(`${BASE}/${group.id}/restore`, { method: 'POST', body: { version: group.version } }),
    { success: ({ group }) => `Add-on group "${group.name}" restored`, error: ({ group }) => `Could not restore "${group.name}"` },
  )

  const addModifier = change(
    'modifier-add',
    ({ group, fields }: GroupChange & { fields: Required<Pick<ModifierFields, 'name' | 'priceDeltaMinor'>> }) =>
      apiFetch<ModifierGroup>(`${BASE}/${group.id}/modifiers`, { method: 'POST', body: { version: group.version, ...fields } }),
    { success: ({ fields }) => `"${fields.name}" added`, error: ({ fields }) => `Could not add "${fields.name}"` },
  )

  const updateModifier = change(
    'modifier-update',
    ({ group, modifier, fields }: ModifierChange & { fields: ModifierFields }) =>
      apiFetch<ModifierGroup>(`${BASE}/${group.id}/modifiers/${modifier.id}`, { method: 'PATCH', body: { version: group.version, ...fields } }),
    { success: ({ modifier, fields }) => `"${fields.name ?? modifier.name}" saved`, error: ({ modifier }) => `Could not save "${modifier.name}"` },
  )

  const archiveModifier = change(
    'modifier-archive',
    ({ group, modifier }: ModifierChange) => apiFetch<ModifierGroup>(`${BASE}/${group.id}/modifiers/${modifier.id}/archive`, { method: 'POST', body: { version: group.version } }),
    {
      success: ({ modifier }) => `"${modifier.name}" archived`,
      error: ({ modifier }) => `Could not archive "${modifier.name}"`,
      confirm: ({ group, modifier }) => ({
        title: `Archive “${modifier.name}”?`,
        description: group.itemCount
          ? `Customers stop seeing it on the ${pluralize(group.itemCount, ['menu item', 'menu items'])} that offer “${group.name}”. You can restore it later.`
          : 'It won\'t be offered with this group until it is restored.',
        confirmLabel: 'Archive add-on',
      }),
    },
  )

  const restoreModifier = change(
    'modifier-restore',
    ({ group, modifier }: ModifierChange) => apiFetch<ModifierGroup>(`${BASE}/${group.id}/modifiers/${modifier.id}/restore`, { method: 'POST', body: { version: group.version } }),
    { success: ({ modifier }) => `"${modifier.name}" restored`, error: ({ modifier }) => `Could not restore "${modifier.name}"` },
  )

  const reorderModifiers = change(
    'modifier-reorder',
    ({ group, modifierIds }: GroupChange & { modifierIds: string[] }) =>
      apiFetch<ModifierGroup>(`${BASE}/${group.id}/modifiers/order`, { method: 'PUT', body: { version: group.version, modifierIds } }),
    { success: () => 'Order saved', error: () => 'Could not save the order' },
  )

  const changes = [update, archive, restore, addModifier, updateModifier, archiveModifier, restoreModifier, reorderModifiers]

  return {
    create,
    update,
    archive,
    restore,
    addModifier,
    updateModifier,
    archiveModifier,
    restoreModifier,
    reorderModifiers,
    /** Any change to this group in flight: disable its actions. */
    isBusy: (groupId: string) => changes.some(m => m.isPending(groupKey(groupId))),
  }
}
