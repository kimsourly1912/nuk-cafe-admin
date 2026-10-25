import type { HistoryState, RouterHistory } from 'vue-router'

/**
 * Back closes the overlay on top, not the page (D201, ui.md → Overlays). A phone's Back (Android's
 * button or edge swipe, iOS's edge swipe) is a history back: the browser gives the page nothing else.
 * So every open modal, slide-over and drawer has a history entry of its own:
 *
 * - **Opening** pushes an entry for the same address, a copy of the page's state plus our marker.
 *   Vue Router never hears of it: its position is the page's, and the router's own entries never
 *   share a position.
 * - **Back** to the page's position is ours: the router doesn't see it (`listen` below), and the
 *   overlay on top gets `onBack`. Its entry is put back at once, so an overlay that stays open (a
 *   form asking about unsaved input, a dialog that can't be dismissed) still has one.
 * - **Closing** another way (X, Escape, Save) steps back over its entry. A closed overlay under an
 *   open one keeps its entry until the one above closes too.
 * - **A route change** first steps back over every entry, so the router pushes or replaces the
 *   page's own entry, never ours; overlays still open afterwards get new ones.
 *
 * Every history step goes through one queue, the router's own `go` (`router.back()`) included: two
 * traversals started together aren't reliable across browsers.
 */

/** Our marker in `history.state`: the entry of one open overlay. */
const ENTRY_KEY = 'overlayEntry'

/** What the module needs from the browser's history (a fake one in the unit tests). */
export interface HistoryApi {
  readonly state: HistoryState | null
  pushState: (state: HistoryState) => void
  go: (delta: number) => void
  /** Runs `move` (a traversal) and resolves once the browser is there (`popstate`, or a time limit). */
  traverse: (move: () => void) => Promise<void>
}

interface Layer {
  onBack: () => void
  /** Its history entry, while it has one. */
  entry?: string
}

export type OverlayHistory = ReturnType<typeof createOverlayHistory>

export function createOverlayHistory(api: HistoryApi) {
  /** The open overlays, oldest first. */
  const layers: Layer[] = []
  /** Our entries above the page's, oldest first, as the browser has them. */
  let trail: string[] = []
  let queue = Promise.resolve()
  /** A traversal of ours is under way: its `popstate` is ours whatever the entry. */
  let traversing = false
  /** A route change is under way: new entries wait for it. */
  let navigating = false
  /** That route change came from Back or Forward: the browser is already on the other page's entry. */
  let poppedAway = false
  let entryCount = 0

  function enqueue(step: () => void | Promise<void>) {
    queue = queue.then(step).catch(() => {})
    return queue
  }

  async function traverse(delta: number) {
    traversing = true
    try {
      await api.traverse(() => api.go(delta))
    }
    finally {
      traversing = false
    }
  }

  const isOpen = (entry: string) => layers.some(layer => layer.entry === entry)

  /** Our entries are no longer where the browser is (another page's entry, or stepped back over). */
  function forgetEntries() {
    trail = []
    for (const layer of layers) layer.entry = undefined
  }

  function push(layer: Layer) {
    enqueue(() => {
      if (navigating || layer.entry || !layers.includes(layer)) return
      layer.entry = `${Date.now().toString(36)}-${++entryCount}`
      api.pushState({ ...api.state, [ENTRY_KEY]: layer.entry })
      trail.push(layer.entry)
    })
  }

  /** Steps back over the entries of closed overlays at the top. */
  function trim() {
    enqueue(async () => {
      let closed = 0
      while (closed < trail.length && !isOpen(trail[trail.length - 1 - closed]!)) closed++
      if (closed === 0) return
      trail = trail.slice(0, -closed)
      await traverse(-closed)
    })
  }

  /** An overlay opened; the returned function is called when it closes or unmounts. */
  function open(onBack: () => void): () => void {
    const layer: Layer = { onBack }
    layers.push(layer)
    push(layer)
    return () => {
      const at = layers.indexOf(layer)
      if (at === -1) return
      layers.splice(at, 1)
      if (layer.entry) trim()
    }
  }

  /**
   * A `popstate`, before the router hears of it: `true` when it was ours. `delta` is the router's:
   * 0 when the position is the page's (ours, or the page's own entry).
   */
  function onPop(delta: number): boolean {
    const entry = api.state?.[ENTRY_KEY] as string | undefined
    if (delta !== 0) {
      // Another page's entry (Back from the page itself, or a long press on Back): the router's.
      forgetEntries()
      navigating = true
      poppedAway = true
      return false
    }
    if (!entry && trail.length === 0 && !traversing) return false

    const depth = entry ? trail.indexOf(entry) + 1 : 0
    const left = trail.splice(depth)
    const backed = layers.filter(layer => layer.entry && left.includes(layer.entry))
    for (const layer of backed) {
      layer.entry = undefined
      push(layer)
    }
    backed.at(-1)?.onBack()
    // An entry left from before (a reload on an open overlay, Forward after one closed): step off it.
    if (entry && depth === 0 && trail.length === 0 && backed.length === 0) enqueue(() => traverse(-1))
    return true
  }

  /** The router is about to change the route (not by Back or Forward): step back over our entries first. */
  function beforeNavigate() {
    if (navigating) return queue
    navigating = true
    return enqueue(async () => {
      if (trail.length === 0) return
      const count = trail.length
      forgetEntries()
      await traverse(-count)
    })
  }

  /** The route change ended (done, refused or failed): overlays still open get their entries back. */
  function afterNavigate() {
    const byPop = poppedAway
    navigating = false
    poppedAway = false
    if (!byPop) for (const layer of layers) push(layer)
  }

  /** After a reload on an open overlay's entry: back to the page's own. */
  function leaveStaleEntry() {
    if (api.state?.[ENTRY_KEY] && trail.length === 0) enqueue(() => traverse(-1))
  }

  /**
   * Resolves once every history step queued so far is done. A history step stops a smooth scroll
   * that has started (Chromium): a page scrolling as an overlay closes waits for this first.
   */
  const settled = () => queue

  /** The router's history, with our `popstate`s kept from it and its traversals in our queue. */
  function wrap(history: RouterHistory): RouterHistory {
    const { listen, go } = history
    history.listen = callback => listen((to, from, info) => {
      if (!onPop(info.delta)) callback(to, from, info)
    })
    history.go = (delta, triggerListeners) => {
      enqueue(() => api.traverse(() => go(delta, triggerListeners)))
    }
    return history
  }

  return { open, onPop, beforeNavigate, afterNavigate, leaveStaleEntry, settled, wrap }
}

/** The browser's history: `popstate` ends a traversal (or a second, for one that goes nowhere). */
export const browserHistoryApi: HistoryApi = {
  get state() {
    return window.history.state as HistoryState | null
  },
  pushState: state => window.history.pushState(state, ''),
  go: delta => window.history.go(delta),
  traverse: move => new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      window.removeEventListener('popstate', done)
      resolve()
    }
    const timer = setTimeout(done, 1000)
    window.addEventListener('popstate', done)
    move()
  }),
}

let instance: OverlayHistory | undefined

/** The app's one overlay history (browser only). */
export function overlayHistory(): OverlayHistory {
  instance ??= createOverlayHistory(browserHistoryApi)
  return instance
}
