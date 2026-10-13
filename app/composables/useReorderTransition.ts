/**
 * The slide of a reorder list: wrap the rows' `v-for` in `<TransitionGroup :move-class="moveClass">`
 * (no `tag`, so the rows stay the Sortable list's children) and pass `onStart` / `onEnd` to
 * `useSortable`. A row moved by its chevrons or keys slides to its new place; a drag doesn't (Sortable
 * animates it itself and the row is already where it was dropped), so the slide is off from the
 * drag's start until the list has rendered the move.
 *
 * `enabled`: only while reordering, so filtering or a refresh never animates the list.
 */
export function useReorderTransition(enabled: MaybeRefOrGetter<boolean> = true) {
  const dragging = ref(false)
  // A class without CSS: Vue finds no transform transition and moves the rows at once.
  const moveClass = computed(() => toValue(enabled) && !dragging.value ? 'reorder-move' : 'reorder-static')

  function onStart() {
    dragging.value = true
  }

  function onEnd() {
    // Sortable's drop updates the data first; the move renders on the next tick.
    nextTick(() => {
      dragging.value = false
    })
  }

  return { moveClass, onStart, onEnd }
}
