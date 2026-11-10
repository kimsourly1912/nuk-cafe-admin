import type { ShopLayout } from '#shared/contracts/shop-layout'

/**
 * The layout being edited (D273): one document, changed only through `change`, with undo and redo
 * as a capped list of snapshots. A drag previews without touching the document and calls `change`
 * once, on drop, so one gesture is one undo step. Lives with the editor: leaving the page drops it.
 */

const HISTORY_LIMIT = 100

export interface LayoutDraft {
  layout: Readonly<Ref<ShopLayout>>
  /** Applies one change to a copy of the layout and records the previous one for undo. */
  change: (apply: (layout: ShopLayout) => void) => void
  undo: () => void
  redo: () => void
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** Starts again from `layout`, forgetting the history. */
  reset: (layout: ShopLayout) => void
}

export function useLayoutDraft(initial: ShopLayout): LayoutDraft {
  const layout = shallowRef<ShopLayout>(initial)
  const past = shallowRef<ShopLayout[]>([])
  const future = shallowRef<ShopLayout[]>([])

  function change(apply: (draft: ShopLayout) => void) {
    const next = structuredClone(toRaw(layout.value))
    apply(next)
    past.value = [...past.value, layout.value].slice(-HISTORY_LIMIT)
    future.value = []
    layout.value = next
  }

  function undo() {
    const previous = past.value.at(-1)
    if (!previous) return
    past.value = past.value.slice(0, -1)
    future.value = [layout.value, ...future.value]
    layout.value = previous
  }

  function redo() {
    const next = future.value[0]
    if (!next) return
    future.value = future.value.slice(1)
    past.value = [...past.value, layout.value]
    layout.value = next
  }

  function reset(next: ShopLayout) {
    layout.value = next
    past.value = []
    future.value = []
  }

  return {
    layout,
    change,
    undo,
    redo,
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),
    reset,
  }
}
