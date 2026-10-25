import type { HistoryState } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { createOverlayHistory, type HistoryApi } from '~/utils/overlay-history'

/**
 * A browser history and a router that work like Vue Router's web history: every route entry has its
 * own position, and the router hears of a `popstate` with the position change (`delta`).
 */
function setup(pages = ['/list', '/page'], options: { reloadedOnOverlay?: boolean } = {}) {
  const entries: HistoryState[] = pages.map((current, position) => ({ position, current }))
  if (options.reloadedOnOverlay) entries.push({ ...entries.at(-1)!, overlayEntry: 'before-reload' })
  let index = entries.length - 1
  let routerState = entries[index]!
  const arrivals: (() => void)[] = []
  /** The pages the router went to on Back/Forward (a `popstate` it heard of). */
  const routed: string[] = []

  const api: HistoryApi = {
    get state() {
      return entries[index] ?? null
    },
    pushState(state) {
      entries.splice(index + 1)
      entries.push(state)
      index++
    },
    go: delta => void setTimeout(() => traverse(delta)),
    traverse: move => new Promise((resolve) => {
      arrivals.push(resolve)
      move()
    }),
  }
  const history = createOverlayHistory(api)

  function traverse(delta: number) {
    const next = Math.min(Math.max(index + delta, 0), entries.length - 1)
    if (next === index) return
    index = next
    const state = entries[index]!
    const routerDelta = (state.position as number) - (routerState.position as number)
    routerState = state
    if (!history.onPop(routerDelta)) routed.push(state.current as string)
    arrivals.splice(0).forEach(resolve => resolve())
  }

  /** `router.push`: the guards, then the router's own entry. */
  async function navigate(path: string) {
    await history.beforeNavigate()
    api.pushState({ position: (routerState.position as number) + 1, current: path })
    routerState = entries[index]!
    history.afterNavigate()
  }

  /** Lets queued history steps and traversals run. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 5))
  const at = () => ({ index, current: entries[index]!.current, overlay: entries[index]!.overlayEntry })

  return { history, entries, routed, at, navigate, settle, back: () => traverse(-1), forward: () => traverse(1) }
}

describe('overlay history (D201)', () => {
  it('Back closes the overlay and stays on the page', async () => {
    const { history, at, back, routed, settle } = setup()
    let close: () => void = () => {}
    const onBack = vi.fn(() => close())
    close = history.open(onBack)
    await settle()
    expect(at()).toMatchObject({ index: 2, current: '/page' })
    expect(at().overlay).toBeTypeOf('string')

    back()
    await settle()
    expect(onBack).toHaveBeenCalledOnce()
    expect(routed).toEqual([])
    expect(at()).toMatchObject({ index: 1, current: '/page', overlay: undefined })

    // The next Back is the page's.
    back()
    expect(routed).toEqual(['/list'])
  })

  it('closing another way steps back over its entry, so Back still leaves the page', async () => {
    const { history, at, back, routed, settle } = setup()
    const close = history.open(() => {})
    await settle()
    close()
    await settle()
    expect(at()).toMatchObject({ index: 1, overlay: undefined })
    back()
    expect(routed).toEqual(['/list'])
  })

  it('settled() waits for the step back over a closed overlay\'s entry (a smooth scroll started sooner stops)', async () => {
    const { history, at, settle } = setup()
    const close = history.open(() => {})
    await settle()
    close()
    expect(at().overlay).toBeTypeOf('string')
    await history.settled()
    expect(at()).toMatchObject({ index: 1, overlay: undefined })
  })

  it('an overlay that stays open on Back keeps an entry for the next Back', async () => {
    const { history, at, back, routed, settle } = setup()
    const onBack = vi.fn()
    history.open(onBack)
    await settle()
    back()
    await settle()
    expect(at().overlay).toBeTypeOf('string')
    back()
    await settle()
    expect(onBack).toHaveBeenCalledTimes(2)
    expect(routed).toEqual([])
  })

  it('Back closes only the overlay on top', async () => {
    const { history, at, back, routed, settle } = setup()
    const below = vi.fn()
    const closeBelow = history.open(below)
    let closeTop: () => void = () => {}
    const top = vi.fn(() => closeTop())
    closeTop = history.open(top)
    await settle()
    expect(at().index).toBe(3)

    back()
    await settle()
    expect(top).toHaveBeenCalledOnce()
    expect(below).not.toHaveBeenCalled()
    expect(at().index).toBe(2)

    closeBelow()
    await settle()
    expect(at()).toMatchObject({ index: 1, overlay: undefined })
    expect(routed).toEqual([])
  })

  it('a closed overlay under an open one keeps its entry until the top one closes', async () => {
    const { history, at, settle } = setup()
    const closeBelow = history.open(() => {})
    const closeTop = history.open(() => {})
    await settle()
    closeBelow()
    await settle()
    expect(at().index).toBe(3)
    closeTop()
    await settle()
    expect(at()).toMatchObject({ index: 1, overlay: undefined })
  })

  it('a route change steps back over the entries first, so the router writes after the page', async () => {
    const { history, entries, at, navigate, back, routed, settle } = setup()
    history.open(() => {})
    await settle()
    await navigate('/next')
    await settle()
    // The router's entry right after the page's; the still open overlay (the page kept it) gets a
    // new entry on the new route.
    expect(entries.map(entry => [entry.current, Boolean(entry.overlayEntry)])).toEqual([
      ['/list', false],
      ['/page', false],
      ['/next', false],
      ['/next', true],
    ])
    expect(at().index).toBe(3)
    back()
    await settle()
    expect(routed).toEqual([])
  })

  it('an overlay that opens while Back goes to another page waits for the route change', async () => {
    const { history, at, back, routed, settle } = setup()
    back()
    expect(routed).toEqual(['/list'])
    // The unsaved-changes question opening while the router asks: no entry over the other page's.
    const close = history.open(() => {})
    await settle()
    expect(at()).toMatchObject({ index: 0, overlay: undefined })
    close()
    history.afterNavigate()
    await settle()
    expect(at().index).toBe(0)
  })

  it('steps off an entry left from before (Forward after closing, a reload)', async () => {
    const { history, at, forward, routed, settle } = setup()
    const close = history.open(() => {})
    await settle()
    close()
    await settle()
    forward()
    await settle()
    expect(at()).toMatchObject({ index: 1, overlay: undefined })
    expect(routed).toEqual([])
  })

  it('after a reload on an overlay\'s entry, goes back to the page\'s own', async () => {
    const { history, at, routed, settle } = setup(['/list', '/page'], { reloadedOnOverlay: true })
    expect(at().overlay).toBe('before-reload')
    history.leaveStaleEntry()
    await settle()
    expect(at()).toMatchObject({ index: 1, current: '/page', overlay: undefined })
    expect(routed).toEqual([])
  })
})
