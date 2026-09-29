import type { MenuItem } from '#shared/contracts/menu-items'
import type { ApiError } from '~/utils/api-error'
import { useModifierGroupOptions } from '~/features/modifier-groups'
import { toCreateItemBody, toItemForm, toUpdateItemBody } from '../schemas/item-form'
import type { ItemForm } from '../schemas/item-form'
import { useItem, useItemMutations } from './useItems'

export interface ItemEditorOptions {
  /** The item to edit: loaded here. Omit (with `item`) to create a new one. */
  itemId?: string
  /** The item as already loaded ("Reopen" after a failed background save). */
  item?: MenuItem
  /** Restores unsaved input (used by "Reopen"). */
  draft?: ItemForm
  /** The form arrived: the owner's unsaved-changes guard takes it as saved. */
  onLoaded: () => void
  /** A failed save after the editor was closed: offer to reopen it with this input. */
  reopen: (item: MenuItem | undefined, draft: ItemForm) => void
}

/**
 * The Menu item editor's state and save, shared by the slide-over (`ProductFormSlideover`) and the
 * route (`ProductEditorPage`, D90): each owns only its surface and its unsaved-changes guard.
 *
 * The API saves the item, its option sets and price grid, add-ons and availability rules under one
 * `version` (D60, D61), so the form sends everything at once, from the version it loaded. The save
 * continues if the editor is closed; a failure then offers "Reopen" with the input restored. A
 * refused save is also kept in `lastError`, shown inside the editor (a toast can't be reached while a
 * slide-over is open, D67). An archived item is read-only.
 */
export function useItemEditor(options: ItemEditorOptions) {
  const { itemId, item, draft, onLoaded, reopen } = options

  const isEdit = itemId !== undefined || item !== undefined
  const itemQuery = itemId && !item ? useItem(itemId) : undefined
  /** The item as loaded when the editor opened: its `version` is what the save names. */
  const loaded = shallowRef<MenuItem | undefined>(item)
  const ready = computed(() => !isEdit || loaded.value !== undefined)
  const archived = computed(() => loaded.value?.status === 'archived')

  const { data: addOnLibrary } = useModifierGroupOptions()
  /** What counts as saved: the item as read (not the draft), so a reopened draft counts as unsaved. */
  const initial = toItemForm(item, addOnLibrary.value)
  const state = reactive<ItemForm>(cloneFormValue(draft ?? initial))

  const { create, update } = useItemMutations()
  const saving = ref(false)
  const uploading = ref(false)
  /** The last refused save, shown inside the editor. */
  const lastError = ref<string>()

  // Editing: fill the form once, when the item arrives. Later refetches don't touch it: the form
  // keeps the version it was opened with (a stale one is refused with 409).
  if (itemQuery) {
    watch(() => itemQuery.data.value, (next) => {
      if (!next || loaded.value) return
      loaded.value = next
      Object.assign(state, cloneFormValue(toItemForm(next, addOnLibrary.value)))
      onLoaded()
    }, { immediate: true })
  }

  let closed = false
  onScopeDispose(() => {
    closed = true
  })

  /** Saves the form. Resolves `true` when saved; on a refusal, the error (also in `lastError`). */
  async function save(): Promise<{ ok: true } | { ok: false, error?: ApiError }> {
    if (uploading.value || archived.value) return { ok: false }
    const input = cloneFormValue(state)
    const overrides = { errorActions: () => (closed ? [{ label: 'Reopen', onClick: () => reopen(loaded.value, input) }] : []) }

    lastError.value = undefined
    saving.value = true
    const result = loaded.value
      ? await update.execute({ id: loaded.value.id, name: input.name.trim(), body: toUpdateItemBody(input, loaded.value) }, overrides)
      : await create.execute(toCreateItemBody(input), overrides)
    saving.value = false

    if (result.ok) return { ok: true }
    if (result.status !== 'error') return { ok: false }
    lastError.value = result.error.code === 'VERSION_CONFLICT'
      ? 'Someone else changed this menu item. Close it and open it again to see their changes (your input will be lost).'
      : result.error.message
    return { ok: false, error: result.error }
  }

  return { isEdit, itemQuery, loaded, ready, archived, initial, state, saving, uploading, lastError, save }
}
