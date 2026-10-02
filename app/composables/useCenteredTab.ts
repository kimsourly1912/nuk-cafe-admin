import type { MaybeRefOrGetter } from 'vue'

/** The element behind a template ref: an element, or a component's root (`$el`). */
function elementOf(target: unknown): HTMLElement | undefined {
  if (target instanceof HTMLElement) return target
  const root = target && typeof target === 'object' && '$el' in target ? target.$el : undefined
  return root instanceof HTMLElement ? root : undefined
}

/**
 * Keeps a scrolling tab row's active tab in view (owner, 2026-10-02, D128): when the tab changes
 * (a tap, the arrow keys, the URL) the row scrolls so that tab sits in the middle, smoothly unless
 * the person asked for reduced motion; on mounting, and whenever the row or a tab changes size
 * (counts arriving), it's there at once. Only the row scrolls, never the page. A row that fits
 * doesn't move.
 *
 * @example
 * const root = useTemplateRef('root')
 * useCenteredTab(root, () => status.value)
 */
export function useCenteredTab(root: MaybeRefOrGetter<unknown>, active: () => unknown) {
  const listOf = () => elementOf(toValue(root))?.querySelector<HTMLElement>('[role="tablist"]') ?? undefined

  function center(smooth: boolean) {
    const list = listOf()
    const tab = list?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return
    const left = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    list.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' })
  }

  // The row's width settles after mounting (counts arrive, a page's tabs appear with its data):
  // each time the row or a tab changes size, the active tab is put back in the middle, at once.
  let observer: ResizeObserver | undefined
  function observe() {
    const list = listOf()
    if (!list || typeof ResizeObserver === 'undefined') return
    observer ??= new ResizeObserver(() => center(false))
    observer.observe(list)
    list.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => observer!.observe(tab))
  }

  onMounted(() => nextTick(observe))
  onBeforeUnmount(() => observer?.disconnect())
  watch(() => elementOf(toValue(root)), () => nextTick(observe), { flush: 'post' })
  watch(active, () => nextTick(() => {
    observe()
    center(true)
  }), { flush: 'post' })
}
