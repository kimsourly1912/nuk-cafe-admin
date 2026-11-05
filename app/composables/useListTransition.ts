import { usePreferredReducedMotion } from '@vueuse/core'
import type { WatchSource } from 'vue'

const STAGGER_MS = 40
/** After this many rows, the rest leave with the last one: a long order still clears in ~0.5 s. */
const MAX_STAGGERED = 8

interface Box { top: number, left: number, width: number, height: number }

function boxOf(el: HTMLElement): Box {
  return { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight }
}

interface ListTransitionOptions {
  /**
   * Values that change *which* rows the list shows (a search, a tab, a branch). While one changes,
   * rows come and go at once: a filter or a tab is not a row arriving or leaving.
   */
  instantWhen?: WatchSource[]
}

/**
 * The enter/leave of a list whose rows come and go (D263): bind the result to a `<TransitionGroup>`
 * whose rows have stable keys (ids, never indexes), on a `relative` container.
 *
 * ```vue
 * <TransitionGroup tag="ul" class="relative flex flex-col gap-3" v-bind="listTransition">
 *   <li v-for="line in lines" :key="line.key">…</li>
 * </TransitionGroup>
 * ```
 *
 * A row added fades in; a row removed fades out, pinned where it stood (absolute, so the rows after
 * it slide up at once), hidden from assistive technology and not clickable while it goes. Rows that
 * leave together ("Clear order") go one after another, 40 ms apart (D264). The first
 * render never animates (no `appear`); nor does anything while an `instantWhen` source changes, or
 * for people who ask for less motion. The CSS is `.list-*` in `tailwind.css`.
 */
export function useListTransition(options: ListTransitionOptions = {}) {
  const { instantWhen = [] } = options
  const reducedMotion = usePreferredReducedMotion()
  const instant = ref(false)

  if (instantWhen.length) {
    // `pre`: before the render that shows the new rows, so that render already skips the transition.
    watch(instantWhen, () => {
      instant.value = true
      nextTick(() => {
        instant.value = false
      })
    }, { flush: 'pre' })
  }

  const css = computed(() => !instant.value && reducedMotion.value !== 'reduce')

  // Rows leaving one container in one render: where every row stood before any was pinned (pinning
  // one moves the rows after it), and how many have left so far, for the stagger. Per container (the
  // counter's three columns share this), cleared after that render.
  const batches = new Map<Element | null, { boxes: Map<Element, Box>, count: number }>()

  function leavingBatch(el: HTMLElement) {
    const parent = el.parentElement
    let batch = batches.get(parent)
    if (!batch) {
      const rows = parent ? [...parent.children].filter(row => row instanceof HTMLElement) : [el]
      batch = { boxes: new Map(rows.map(row => [row, boxOf(row)])), count: 0 }
      batches.set(parent, batch)
      if (batches.size === 1) {
        queueMicrotask(() => {
          batches.clear()
        })
      }
    }
    return batch
  }

  /** Pins the leaving row where it is, so the rows after it can move into its place now. */
  function onBeforeLeave(el: Element) {
    if (!css.value || !(el instanceof HTMLElement)) return
    const current = leavingBatch(el)
    const { top, left, width, height } = current.boxes.get(el) ?? boxOf(el)
    const order = current.count++
    Object.assign(el.style, {
      position: 'absolute',
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      height: `${height}px`,
      margin: '0',
      pointerEvents: 'none',
      transitionDelay: `${Math.min(order, MAX_STAGGERED) * STAGGER_MS}ms`,
    })
    el.setAttribute('aria-hidden', 'true')
    el.inert = true
  }

  return reactive({ name: 'list', css, onBeforeLeave })
}
