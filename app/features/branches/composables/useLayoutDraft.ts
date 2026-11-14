import { streetDoor } from '#shared/contracts/shop-layout'
import type { ShopLayout } from '#shared/contracts/shop-layout'
import { floorLimitProblem } from '../designer/limits'

/**
 * The layout being edited (D273): one document, changed only through `change`, with undo and redo
 * as a capped list of snapshots. A drag previews without touching the document and calls `change`
 * once, on drop, so one gesture is one undo step. Lives with the editor: leaving the page drops it.
 *
 * A change that takes a floor over the contract's limits is not made (ISS-043): `change` returns
 * false and `onRefused` says why. A change that removes Explore's street door clears it and turns
 * Explore off (the contract needs both); the editor asks first (ISS-038, `losesStreetDoor`).
 */

const HISTORY_LIMIT = 100

export interface LayoutDraft {
  layout: Readonly<Ref<ShopLayout>>
  /**
   * Applies one change to a copy of the layout and records the previous one for undo. False when
   * it was refused: anything `apply` returned through a closure is then not in the layout.
   */
  change: (apply: (layout: ShopLayout) => void) => boolean
  undo: () => void
  redo: () => void
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
  /** Starts again from `layout`, forgetting the history. */
  reset: (layout: ShopLayout) => void
}

export interface LayoutDraftOptions {
  /** Told why a change was refused (a floor over a limit). */
  onRefused?: (reason: string) => void
}

/** Whether `after` no longer has the street door `before` had for Explore (ISS-038). */
export function losesStreetDoor(before: Pick<ShopLayout, 'floors' | 'scene'>, after: Pick<ShopLayout, 'floors'>): boolean {
  const entrance = before.scene?.entrance
  return entrance != null && Boolean(streetDoor(before.floors, entrance)) && !streetDoor(after.floors, entrance)
}

export function useLayoutDraft(initial: ShopLayout, options: LayoutDraftOptions = {}): LayoutDraft {
  const layout = shallowRef<ShopLayout>(initial)
  const past = shallowRef<ShopLayout[]>([])
  const future = shallowRef<ShopLayout[]>([])

  function change(apply: (draft: ShopLayout) => void) {
    const next = structuredClone(toRaw(layout.value))
    apply(next)
    const refused = floorLimitProblem(layout.value, next)
    if (refused) {
      options.onRefused?.(refused)
      return false
    }
    if (next.scene?.entrance != null && !streetDoor(next.floors, next.scene.entrance)) {
      next.scene.entrance = null
      next.scene.explore = false
    }
    past.value = [...past.value, layout.value].slice(-HISTORY_LIMIT)
    future.value = []
    layout.value = next
    return true
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
