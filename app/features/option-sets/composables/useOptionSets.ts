import type { ConfirmOptions } from '~/utils/mutation'
import type { CreateOptionSetInput, OptionSet, OptionValue } from '#shared/contracts/menu-options'
import { archiveSetDescription } from '../schemas/option-set-display'

const BASE = '/admin/menu/option-sets'

/** Features whose data shows option set or value names (the menu-item form and grid). */
const AFFECTED = ['option-sets', 'products']

/**
 * Every change to a set (its values included) moves the set's one `version` (D58), so they must
 * run one at a time: they share this key and lock. A second change while one is saving is skipped
 * with a toast; the editor disables its actions meanwhile anyway.
 */
const setKey = (setId: string) => `option-set:${setId}`

/** Every set, active and archived: the library is small, so the page filters and counts itself. */
export function useOptionSetList() {
  return useApiQuery('option-sets:list', () => apiFetch<OptionSet[]>(BASE, { query: { status: 'all' } }))
}

/** One set, fresh from the server (the editor's Reload after someone else changed it). */
export const fetchOptionSet = (id: string) => apiFetch<OptionSet>(`${BASE}/${id}`)

export const activeValues = (set: OptionSet) => set.values.filter(v => v.status === 'active')
export const archivedValues = (set: OptionSet) => set.values.filter(v => v.status === 'archived')

interface SetChange {
  set: OptionSet
}
interface ValueChange extends SetChange {
  value: OptionValue
}

/**
 * Option set mutations. Each resolves to the whole set as it now is, so the editor can replace its
 * copy and send the new version with the next change.
 */
export function useOptionSetMutations() {
  const create = useMutation(
    (body: CreateOptionSetInput) => apiFetch<OptionSet>(BASE, { method: 'POST', body }),
    {
      id: 'option-sets:create',
      // Same name in flight = same submission (double submit); different names run in parallel.
      key: body => body.name.toLowerCase(),
      successMessage: (_, body) => `Option set "${body.name}" created`,
      errorMessage: body => `Could not create "${body.name}"`,
      invalidate: AFFECTED,
    },
  )

  /** One change to a set: shared key, lock and refresh. */
  function change<T extends SetChange>(id: string, request: (input: T) => Promise<OptionSet>, messages: { success: ((input: T) => string) | false, error: (input: T) => string, confirm?: (input: T) => ConfirmOptions }) {
    const { success } = messages
    return useMutation(request, {
      id: `option-sets:${id}`,
      key: input => setKey(input.set.id),
      lock: input => setKey(input.set.id),
      confirm: messages.confirm,
      successMessage: success && ((_, input) => success(input)),
      errorMessage: messages.error,
      invalidate: AFFECTED,
    })
  }

  const rename = change(
    'rename',
    ({ set, name }: SetChange & { name: string }) => apiFetch<OptionSet>(`${BASE}/${set.id}`, { method: 'PATCH', body: { version: set.version, name } }),
    { success: ({ name }) => `Renamed to "${name}"`, error: ({ set }) => `Could not rename "${set.name}"` },
  )

  const archive = useMutation(
    ({ set }: SetChange) => apiFetch<OptionSet>(`${BASE}/${set.id}/archive`, { method: 'POST', body: { version: set.version } }),
    {
      id: 'option-sets:archive',
      key: ({ set }) => setKey(set.id),
      lock: ({ set }) => setKey(set.id),
      confirm: ({ set }) => ({
        title: `Archive “${set.name}”?`,
        description: archiveSetDescription(set.itemCount),
        confirmLabel: 'Archive option set',
      }),
      successMessage: (_, { set }) => `Option set "${set.name}" archived`,
      errorMessage: ({ set }) => `Could not archive "${set.name}"`,
      invalidate: AFFECTED,
    },
  )

  const restore = change(
    'restore',
    ({ set }: SetChange) => apiFetch<OptionSet>(`${BASE}/${set.id}/restore`, { method: 'POST', body: { version: set.version } }),
    { success: ({ set }) => `Option set "${set.name}" restored`, error: ({ set }) => `Could not restore "${set.name}"` },
  )

  const addValue = change(
    'value-add',
    ({ set, name }: SetChange & { name: string }) => apiFetch<OptionSet>(`${BASE}/${set.id}/values`, { method: 'POST', body: { version: set.version, name } }),
    { success: ({ name }) => `"${name}" added`, error: ({ name }) => `Could not add "${name}"` },
  )

  const renameValue = change(
    'value-rename',
    ({ set, value, name }: ValueChange & { name: string }) => apiFetch<OptionSet>(`${BASE}/${set.id}/values/${value.id}`, { method: 'PATCH', body: { version: set.version, name } }),
    { success: ({ name }) => `Renamed to "${name}"`, error: ({ value }) => `Could not rename "${value.name}"` },
  )

  const archiveValue = change(
    'value-archive',
    ({ set, value }: ValueChange) => apiFetch<OptionSet>(`${BASE}/${set.id}/values/${value.id}/archive`, { method: 'POST', body: { version: set.version } }),
    {
      success: ({ value }) => `"${value.name}" archived`,
      error: ({ value }) => `Could not archive "${value.name}"`,
      confirm: ({ value }) => ({
        title: `Archive “${value.name}”?`,
        description: 'Menu-item versions that use this value will be hidden until it is restored.',
        confirmLabel: 'Archive value',
      }),
    },
  )

  const restoreValue = change(
    'value-restore',
    ({ set, value }: ValueChange) => apiFetch<OptionSet>(`${BASE}/${set.id}/values/${value.id}/restore`, { method: 'POST', body: { version: set.version } }),
    { success: ({ value }) => `"${value.name}" restored`, error: ({ value }) => `Could not restore "${value.name}"` },
  )

  const reorderValues = change(
    'value-reorder',
    ({ set, valueIds }: SetChange & { valueIds: string[] }) => apiFetch<OptionSet>(`${BASE}/${set.id}/values/order`, { method: 'PUT', body: { version: set.version, valueIds } }),
    // No toast per save: the editor's header says "Saving…" / "Saved" (reorder saves after each pause).
    { success: false, error: () => 'Could not save the order' },
  )

  const changes = [rename, archive, restore, addValue, renameValue, archiveValue, restoreValue, reorderValues]

  return {
    create,
    rename,
    archive,
    restore,
    addValue,
    renameValue,
    archiveValue,
    restoreValue,
    reorderValues,
    /** Any change to this set in flight: disable its actions. */
    isBusy: (setId: string) => changes.some(m => m.isPending(setKey(setId))),
  }
}
