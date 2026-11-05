import { usePreferredReducedMotion } from '@vueuse/core'
import type { WatchSource } from 'vue'

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
 * it slide up at once), hidden from assistive technology and not clickable while it goes. The first
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

  /** Pins the leaving row where it is, so the rows after it can move into its place now. */
  function onBeforeLeave(el: Element) {
    if (!css.value || !(el instanceof HTMLElement)) return
    const { offsetTop, offsetLeft, offsetWidth, offsetHeight } = el
    Object.assign(el.style, {
      position: 'absolute',
      top: `${offsetTop}px`,
      left: `${offsetLeft}px`,
      width: `${offsetWidth}px`,
      height: `${offsetHeight}px`,
      margin: '0',
      pointerEvents: 'none',
    })
    el.setAttribute('aria-hidden', 'true')
    el.inert = true
  }

  return reactive({ name: 'list', css, onBeforeLeave })
}
