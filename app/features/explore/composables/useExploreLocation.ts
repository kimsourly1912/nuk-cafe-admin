import type { Pin } from '../runtime/network'

export type LocationState
  = | { kind: 'idle' }
    | { kind: 'locating' }
    | { kind: 'found', position: Pin }
    | { kind: 'denied' }
    | { kind: 'unavailable' }

/** Asked on a tap only (a user gesture), with a 10 s timeout, reusing a fix up to 5 minutes old. */
const OPTIONS: PositionOptions = { timeout: 10_000, maximumAge: 5 * 60_000, enableHighAccuracy: false }

/**
 * Where the customer is, for the nearby list (D275 decision 6, docs/plans/explore.md → Location):
 * asked only when they tap **Explore nearby**, kept in this page's memory, and never sent to our
 * server: distances are worked out in the browser. Denied or unavailable, the list goes by name
 * and everything else works the same.
 */
export function useExploreLocation() {
  const state = ref<LocationState>({ kind: 'idle' })
  let asked = 0

  function locate() {
    if (state.value.kind === 'locating') return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      state.value = { kind: 'unavailable' }
      return
    }
    const request = ++asked
    state.value = { kind: 'locating' }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (request !== asked) return
        state.value = { kind: 'found', position: { latitude: position.coords.latitude, longitude: position.coords.longitude } }
      },
      (error) => {
        if (request !== asked) return
        state.value = { kind: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable' }
      },
      OPTIONS,
    )
  }

  // Leaving the page forgets the position and ignores an answer still on its way.
  onScopeDispose(() => {
    asked++
  })

  return {
    state: readonly(state),
    position: computed(() => (state.value.kind === 'found' ? state.value.position : null)),
    locate,
  }
}
