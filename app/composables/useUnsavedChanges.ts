import { tryOnScopeDispose } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'

/**
 * Warn before unsaved form input is lost. Three pieces:
 *
 * - `useUnsavedChanges(state)`: tracks one form and registers it app-wide. Page forms use it directly.
 * - `useModalUnsavedChanges(state, { close })`: the same, plus asking before the modal closes.
 * - `useLeaveGuard()`: the app-wide check. `middleware/unsaved-changes.global.ts` runs it on every
 *   route change and `plugins/leave-guard.client.ts` on tab close/reload. It shows one dialog however
 *   many forms are open, and on "Discard" every open form is discarded (modals close).
 *
 * "Unsaved" means the values differ from what the form opened with (`isSameFormValue`), so typing
 * and undoing it isn't unsaved.
 */

interface UnsavedForm {
  isDirty: () => boolean
  discard: () => void
}

const DISCARD_DIALOG = {
  title: 'Discard unsaved changes?',
  description: 'The changes you made will be lost.',
  confirmLabel: 'Discard',
  cancelLabel: 'Keep editing',
  danger: true,
}

const useUnsavedForms = () => useState('unsaved:forms', () => shallowReactive(new Set<UnsavedForm>()))

export interface UnsavedChangesOptions<T> {
  /** What counts as "saved". Defaults to `state` when the form opens; pass it when a form opens from a draft. */
  initial?: T
  /** Treat the form as saved while true, e.g. while its save is running. */
  paused?: MaybeRefOrGetter<boolean>
  /** Called when the user discards from outside the form (route change, logout). Modals close here. */
  onDiscard?: () => void
}

/**
 * Tracks whether `state` differs from its value when the form opened.
 * Call `markClean()` after saving if the form stays open (or before redirecting away).
 *
 * @example
 * const state = reactive(toProductForm(props.product))
 * const saving = ref(false)
 * const { isDirty, markClean } = useUnsavedChanges(state, { paused: saving })
 */
export function useUnsavedChanges<T extends object>(state: MaybeRefOrGetter<T>, options: UnsavedChangesOptions<T> = {}) {
  const baseline = shallowRef(cloneFormValue(options.initial ?? toValue(state)))
  const markClean = () => {
    baseline.value = cloneFormValue(toValue(state))
  }
  const isDirty = computed(() => !toValue(options.paused) && !isSameFormValue(toValue(state), baseline.value))

  const forms = useUnsavedForms()
  const form: UnsavedForm = {
    isDirty: () => isDirty.value,
    discard: () => {
      markClean()
      options.onDiscard?.()
    },
  }
  forms.value.add(form)
  tryOnScopeDispose(() => forms.value.delete(form))

  return { isDirty, markClean }
}

/**
 * `useUnsavedChanges` for a form in a `UModal` (or `USlideover`/`UDrawer`). Bind `onOpenChange` to
 * the modal's `update:open` (catches X, Esc and outside click) and call `requestClose()` from Cancel.
 * The component must declare the `update:open` emit so the overlay's own listener doesn't close it.
 *
 * @example
 * const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()
 * const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close', false) })
 * // <UModal @update:open="unsaved.onOpenChange"> ... <UButton label="Cancel" @click="unsaved.requestClose()" />
 */
export function useModalUnsavedChanges<T extends object>(
  state: MaybeRefOrGetter<T>,
  options: Omit<UnsavedChangesOptions<T>, 'onDiscard'> & { close: () => void },
) {
  const { isDirty, markClean } = useUnsavedChanges(state, { ...options, onDiscard: options.close })
  const confirm = useConfirm()

  async function requestClose() {
    if (isDirty.value && !await confirm(DISCARD_DIALOG)) return
    // Discarded: the form stays registered until the overlay unmounts, and a navigation on close
    // (the Menu items list removing `?item=`, D90) must not ask again.
    markClean()
    options.close()
  }

  function onOpenChange(open: boolean) {
    if (!open) requestClose()
  }

  return { isDirty, markClean, requestClose, onOpenChange }
}

let leaving: Promise<boolean> | undefined

/** App-wide check across every open form. Used by the route middleware, the tab-close guard and logout. */
export function useLeaveGuard() {
  const forms = useUnsavedForms()
  const confirm = useConfirm()
  const hasUnsavedChanges = computed(() => [...forms.value].some(form => form.isDirty()))

  /** Resolves `true` when nothing is unsaved or the user chose "Discard" (every form is then discarded). */
  function confirmLeave(): Promise<boolean> {
    // Back pressed twice while asking: one dialog, one answer.
    leaving ??= (async () => {
      const dirty = [...forms.value].filter(form => form.isDirty())
      if (dirty.length === 0) return true
      if (!await confirm(DISCARD_DIALOG)) return false
      dirty.forEach(form => form.discard())
      return true
    })().finally(() => {
      leaving = undefined
    })
    return leaving
  }

  /**
   * Discards every open form **without asking**. Only for transitions where staying isn't possible
   * (session expired, logged out in another tab); a voluntary logout asks first (`confirmLeave`).
   */
  function discardAll() {
    for (const form of [...forms.value]) form.discard()
  }

  return { hasUnsavedChanges, confirmLeave, discardAll }
}
