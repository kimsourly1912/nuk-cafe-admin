import type { MenuItem } from '#shared/contracts/menu-items'
import type { ApiError } from '~/utils/api-error'
import { useAuth } from '~/features/auth'
import { useModifierGroupOptions } from '~/features/modifier-groups'
import { ITEM_FORM_PARTS, toCreateItemBody, toItemForm, toUpdateItemBody } from '../schemas/item-form'
import type { ItemForm } from '../schemas/item-form'
import { fetchItem, useItem, useItemMutations } from './useItems'

export interface ItemEditorOptions {
  /** The item to edit: loaded here. Omit (with `item`) to create a new one. */
  itemId?: string
  /** The item as already loaded ("Reopen" after a failed background save). */
  item?: MenuItem
  /** Restores unsaved input (used by "Reopen"). */
  draft?: ItemForm
  /** The form arrived: the owner's unsaved-changes guard takes it as saved. */
  onLoaded: () => void
  /** Reload took someone else's newer version: what's saved now, for the unsaved-changes guard. */
  onReloaded: (saved: ItemForm) => void
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
 *
 * Someone else saved the item first (409, D41): `conflict`, and `reload()` takes their version
 * with this input on top, part by part (`ITEM_FORM_PARTS`, D153). `reloaded.overlap` names the parts
 * both changed, where this input won: the editor says so, and the next Save overwrites with it.
 *
 * "Save and publish" (a new item or a draft, D125) saves, then publishes the version the save
 * returned, through the list's own publish action. If the server refuses to publish (nothing to
 * sell yet, a category that holds sub-categories), the item stays saved as a draft and the editor
 * closes; the toast says it was saved but not published, and why.
 */
export function useItemEditor(options: ItemEditorOptions) {
  const { itemId, item, draft, onLoaded, onReloaded, reopen } = options

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
  /** `loaded` as a form: what this person's changes are measured from when someone else saved first. */
  let loadedForm = initial

  const { create, update, publish } = useItemMutations()
  /** A new item or a draft can be published from the form. */
  const canPublish = computed(() => !archived.value && (!isEdit || loaded.value?.status === 'draft'))
  const saving = ref(false)
  const uploading = ref(false)
  /** The last refused save, shown inside the editor. */
  const lastError = ref<string>()
  /** Someone else saved since this version was read: Save is refused until `reload()`. */
  const conflict = ref(false)
  const reloading = ref(false)
  /** The last reload: the parts both people changed, where this input was kept over theirs. */
  const reloaded = ref<{ overlap: string[] } | null>(null)

  // Editing: fill the form once, when the item arrives. Later refetches don't touch it: the form
  // keeps the version it was opened with (a stale one is refused with 409).
  if (itemQuery) {
    watch(() => itemQuery.data.value, (next) => {
      if (!next || loaded.value) return
      loaded.value = next
      loadedForm = toItemForm(next, addOnLibrary.value)
      Object.assign(state, cloneFormValue(loadedForm))
      onLoaded()
    }, { immediate: true })
  }

  let closed = false
  onScopeDispose(() => {
    closed = true
  })

  /**
   * Saves the form, and publishes it when asked (`canPublish` only). Resolves `ok` once saved: a
   * refused publish leaves a saved draft, reported by its own toast. On a refused save, the error
   * (also in `lastError`).
   */
  async function save(options: { publish?: boolean } = {}): Promise<{ ok: true } | { ok: false, error?: ApiError }> {
    const publishing = Boolean(options.publish && canPublish.value)
    if (uploading.value || archived.value) return { ok: false }
    const input = cloneFormValue(state)
    const overrides = { errorActions: () => (closed ? [{ label: 'Reopen', onClick: () => reopen(loaded.value, input) }] : []) }

    lastError.value = undefined
    conflict.value = false
    reloaded.value = null
    saving.value = true
    const result = loaded.value
      ? await update.execute({ id: loaded.value.id, name: input.name.trim(), body: toUpdateItemBody(input, loaded.value), publishing }, overrides)
      : await create.execute({ body: toCreateItemBody(input), publishing }, overrides)

    if (result.ok) {
      const saved = result.data
      if (publishing) await publish.execute({ id: saved.id, name: saved.name, version: saved.version, afterSave: true })
      saving.value = false
      return { ok: true }
    }
    saving.value = false
    if (result.status !== 'error') return { ok: false }
    if (result.error.code === 'VERSION_CONFLICT') conflict.value = true
    else lastError.value = result.error.message
    return { ok: false, error: result.error }
  }

  /**
   * Takes the newer version someone else saved, keeps this input on top (D153). The form stays
   * unsaved: the next Save names the new version. An item archived meanwhile can't be edited: its
   * input stays in this browser (D151), offered back once it's restored and opened again.
   */
  async function reload() {
    const current = loaded.value
    if (!current || reloading.value) return
    reloading.value = true
    lastError.value = undefined
    const latest = await fetchItem(current.id).catch(() => undefined)
    reloading.value = false
    if (!latest) {
      lastError.value = 'Couldn\'t load the latest version. Check the connection and try again.'
      return
    }
    if (latest.status === 'archived') {
      conflict.value = false
      lastError.value = 'Someone archived this menu item meanwhile. Restore it from the list and open it again: your changes are kept in this browser.'
      return
    }
    const theirs = toItemForm(latest, addOnLibrary.value)
    const { merged, overlap } = mergeFormChanges({ base: loadedForm, mine: cloneFormValue(state), theirs, parts: ITEM_FORM_PARTS })
    loaded.value = latest
    loadedForm = theirs
    onReloaded(theirs)
    Object.assign(state, merged)
    conflict.value = false
    reloaded.value = { overlap }
  }

  const auth = useAuth()
  /**
   * The input kept in this browser (D151), for both surfaces' unsaved-changes guard: one draft per
   * person and item (or one new item), so a crash in the slide-over is offered back on the page too.
   * None for an archived item (read-only) or before the item has loaded.
   */
  const keptDraft = {
    key: () => {
      const owner = auth.user.value?.userId
      if (!owner || archived.value || (isEdit && !loaded.value)) return null
      return { owner, form: 'menu-item', record: loaded.value?.id ?? 'new' }
    },
    version: () => loaded.value?.version,
  }

  return { isEdit, itemQuery, loaded, ready, archived, canPublish, initial, state, saving, uploading, lastError, conflict, reloading, reloaded, reload, keptDraft, save }
}
