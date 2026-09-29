import { useEventListener, usePreferredReducedMotion } from '@vueuse/core'

/**
 * Which section the customer is reading (D93): the last one whose top has passed under the sticky
 * header (`offset`), or the last one once the page can't scroll further (a short last section could
 * never reach the top). `scrollTo` moves a section under the header and holds it as the active one
 * until the customer scrolls themselves: the spy doesn't pass through every section on the way, and
 * a section near the end that can't reach the top stays the one they picked.
 *
 * One source of truth for the tabs and the category tree: both read `active`. Sections need
 * `tabindex="-1"`: `scrollTo` moves focus to them.
 */
export function useScrollSpy(ids: MaybeRefOrGetter<string[]>, offset: MaybeRefOrGetter<number>) {
  const active = ref<string>()
  const motion = usePreferredReducedMotion()
  /**
   * After `scrollTo`: the target stays active until the customer scrolls themselves. The smooth
   * scroll counts as settled once no scroll event came for `SETTLE_MS`; after that, any movement
   * (keys, scrollbar) ends the hold. A wheel or a touch drag ends it at once, even mid-scroll.
   */
  let hold: { settledAt?: number, timer?: ReturnType<typeof setTimeout> } | undefined
  const SETTLE_MS = 150

  function settleLater() {
    if (!hold) return
    clearTimeout(hold.timer)
    hold.timer = setTimeout(() => {
      if (hold) hold.settledAt = window.scrollY
    }, SETTLE_MS)
  }

  function release() {
    if (!hold) return
    clearTimeout(hold.timer)
    hold = undefined
    schedule()
  }

  function onScroll() {
    if (hold) {
      if (hold.settledAt === undefined) return settleLater()
      if (Math.abs(window.scrollY - hold.settledAt) <= 2) return
      return release()
    }
    schedule()
  }

  function update() {
    if (hold) return
    const list = toValue(ids)
    const root = document.documentElement
    if (!list.length) {
      active.value = undefined
      return
    }
    if (window.scrollY > 0 && window.innerHeight + window.scrollY >= root.scrollHeight - 2) {
      active.value = list.at(-1)
      return
    }
    let current = list[0]
    for (const id of list) {
      const top = document.getElementById(id)?.getBoundingClientRect().top
      if (top === undefined) continue
      if (top - toValue(offset) > 1) break
      current = id
    }
    active.value = current
  }

  let frame = 0
  function schedule() {
    // Nothing to measure while rendering on the server (D95); the browser measures after mounting.
    if (import.meta.server || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }
  useEventListener(window, 'scroll', onScroll, { passive: true })
  useEventListener(window, 'resize', schedule, { passive: true })
  useEventListener(window, 'wheel', release, { passive: true })
  useEventListener(window, 'touchmove', release, { passive: true })
  onScopeDispose(() => {
    clearTimeout(hold?.timer)
    cancelAnimationFrame(frame)
  })
  watch(() => toValue(ids), () => nextTick(schedule), { immediate: true })

  function scrollTo(id: string) {
    const element = document.getElementById(id)
    if (!element) return
    active.value = id
    const top = element.getBoundingClientRect().top + window.scrollY - toValue(offset)
    clearTimeout(hold?.timer)
    hold = {}
    // Settles even if the page doesn't move (already there, or at the end).
    settleLater()
    window.scrollTo({ top: Math.max(0, top), behavior: motion.value === 'reduce' ? 'auto' : 'smooth' })
    // Keyboard and screen-reader users continue from the section they chose.
    element.focus({ preventScroll: true })
  }

  return { active: readonly(active), scrollTo }
}
