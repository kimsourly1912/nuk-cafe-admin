import { tryOnScopeDispose, useEventListener } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'
import type { FormDraftKey, StoredFormDraft } from '~/utils/form-draft'

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
 *
 * A long form can also keep its unsaved input in the browser (the `draft` option, D151): after a
 * crash, a dead battery or a phone dropping the tab, the form offers it back (`<FormDraftAlert>`).
 */

/**
 * Why a form is discarded: the person chose Discard (`user`: its draft goes too), or the session
 * ended and staying wasn't possible (`session`: its draft stays, for the same person to restore).
 */
type DiscardReason = 'user' | 'session'

interface UnsavedForm {
  isDirty: () => boolean
  discard: (reason: DiscardReason) => void
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
  /**
   * Unsaved while true, whatever the values: input not in them yet, such as a photo still uploading
   * or one whose upload failed (D160).
   */
  pending?: MaybeRefOrGetter<boolean>
  /** Called when the user discards from outside the form (route change, logout). Modals close here. */
  onDiscard?: () => void
  /** Keep the unsaved input in this browser and offer it back (D151). Only for long forms. */
  draft?: UnsavedDraftOptions
}

export interface UnsavedDraftOptions {
  /**
   * Who typed it, which form and which record (the cafe is added). `null` while unknown or not
   * editable (the record loading, an archived record): nothing is read or kept then.
   */
  key: MaybeRefOrGetter<Omit<FormDraftKey, 'tenant'> | null>
  /** The record's version the form was opened at, to say when it changed since the draft. */
  version?: MaybeRefOrGetter<number | undefined>
}

/** A draft from an earlier visit, offered back (`<FormDraftAlert>`). */
export interface FormDraftOffer {
  /** When it was last typed; `null` when nothing is offered. */
  savedAt: number | null
  /** Someone saved the record after the draft was typed: restoring puts the draft's values over theirs. */
  changedSince: boolean
  /** Puts the draft into the form (still unsaved). */
  restore: () => void
  /** Drops the offered draft. */
  dismiss: () => void
}

/** How long typing settles before the draft is written (the tab being hidden writes at once). */
const DRAFT_WRITE_DELAY_MS = 500

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
  /** What is saved now: the input as it is, or `saved` (someone else's newer version, with this input on top). */
  const markClean = (saved?: T) => {
    baseline.value = cloneFormValue(saved ?? toValue(state))
  }
  const isDirty = computed(() => !toValue(options.paused) && (Boolean(toValue(options.pending)) || !isSameFormValue(toValue(state), baseline.value)))
  const draft = useStoredDraft(state, baseline, options.draft)

  /** Saved: the form is clean and its kept draft is gone. Use it instead of `markClean` after a save. */
  const markSaved = () => {
    markClean()
    draft.remove()
  }

  const forms = useUnsavedForms()
  const form: UnsavedForm = {
    isDirty: () => isDirty.value,
    discard: (reason) => {
      // The session ended: keep what was typed for the same person. The person chose Discard: drop it.
      if (reason === 'session') draft.flush(true)
      markClean()
      if (reason === 'user') draft.remove()
      options.onDiscard?.()
    },
  }
  forms.value.add(form)
  tryOnScopeDispose(() => forms.value.delete(form))

  return { isDirty, markClean, markSaved, draft: draft.offer }
}

/**
 * The `draft` option of `useUnsavedChanges` (D151): writes the input to browser storage while it
 * differs from what's saved (a moment after typing settles, or at once when the tab is hidden), and
 * offers a stored draft back once the form knows its record. Without the option it does nothing.
 */
function useStoredDraft<T extends object>(state: MaybeRefOrGetter<T>, baseline: Ref<T>, options: UnsavedDraftOptions | undefined) {
  const store = createFormDraftStore(import.meta.client ? browserDraftStorage() : undefined)
  // Read once: a modal closing after a route change still writes to its own cafe's draft.
  const tenant = useTenantSlug().value
  const storageKey = computed(() => {
    const key = options && toValue(options.key)
    return key ? formDraftKey({ tenant, ...key }) : null
  })

  // The form's key is fixed once known. When the session ends the person is already gone (or
  // replaced by another account) before the form is discarded: what they typed still goes under
  // their own key, and nothing typed afterwards is written while the key reads differently.
  let fixedKey: string | null = null
  watch(storageKey, (key) => {
    fixedKey ??= key
  }, { immediate: true, flush: 'sync' })
  const isCurrent = () => fixedKey !== null && storageKey.value === fixedKey

  const offered = shallowRef<StoredFormDraft<T> | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Writes now; `ending` (the session ended) writes under the form's own key whoever is signed in. */
  function flush(ending = false) {
    clearTimeout(timer)
    timer = undefined
    const key = fixedKey
    if (!key || (!ending && !isCurrent())) return
    if (isSameFormValue(toValue(state), baseline.value)) {
      // Nothing typed: storage still holds the draft on offer, unanswered. Keep it.
      if (!offered.value) store.remove(key)
      return
    }
    store.write(key, cloneFormValue(toValue(state)), toValue(options?.version))
  }

  function remove() {
    clearTimeout(timer)
    timer = undefined
    offered.value = null
    if (fixedKey) store.remove(fixedKey)
  }

  if (options && import.meta.client) {
    // Offer a stored draft once the record is known, unless it holds nothing the form doesn't.
    let checked = false
    watch(storageKey, (key) => {
      if (!key || checked) return
      checked = true
      const stored = store.read<T>(key)
      if (!stored) return
      if (isSameFormValue(stored.value, toValue(state))) store.remove(key)
      else offered.value = stored
    }, { immediate: true })

    watch(() => toValue(state), () => {
      if (!isCurrent()) return
      clearTimeout(timer)
      timer = setTimeout(() => flush(), DRAFT_WRITE_DELAY_MS)
    }, { deep: true })

    // A phone may drop a hidden tab without another event: write before it can.
    useEventListener(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden' && timer) flush()
    })
    useEventListener(window, 'pagehide', () => {
      if (timer) flush()
    })
    tryOnScopeDispose(() => {
      if (timer) flush()
    })
  }

  const offer: FormDraftOffer = reactive({
    savedAt: computed(() => offered.value?.savedAt ?? null),
    changedSince: computed(() => {
      const then = offered.value?.version
      const now = toValue(options?.version)
      return then !== undefined && now !== undefined && then !== now
    }),
    restore: () => {
      const stored = offered.value
      if (!stored) return
      offered.value = null
      Object.assign(toValue(state), cloneFormValue(stored.value))
    },
    dismiss: () => {
      offered.value = null
      // Storage holds the latest typing once the person edited: keep that.
      if (fixedKey && isSameFormValue(toValue(state), baseline.value)) store.remove(fixedKey)
    },
  })

  return { offer, flush, remove }
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
  const { isDirty, markClean, markSaved, draft } = useUnsavedChanges(state, { ...options, onDiscard: options.close })
  const confirm = useConfirm()

  async function requestClose() {
    const discarding = isDirty.value
    if (discarding && !await confirm(DISCARD_DIALOG)) return
    // Discarded: the form stays registered until the overlay unmounts, and a navigation on close
    // (the Menu items list removing `?item=`, D90) must not ask again. Discarded input leaves no draft.
    if (discarding) markSaved()
    else markClean()
    options.close()
  }

  function onOpenChange(open: boolean) {
    if (!open) requestClose()
  }

  return { isDirty, markClean, markSaved, draft, requestClose, onOpenChange }
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
      dirty.forEach(form => form.discard('user'))
      return true
    })().finally(() => {
      leaving = undefined
    })
    return leaving
  }

  /**
   * Discards every open form **without asking**. Only for transitions where staying isn't possible
   * (session expired, logged out in another tab); a voluntary logout asks first (`confirmLeave`).
   * A form keeping drafts (D151) keeps what was typed, for the same person to restore.
   */
  function discardAll() {
    for (const form of [...forms.value]) form.discard('session')
  }

  return { hasUnsavedChanges, confirmLeave, discardAll }
}
