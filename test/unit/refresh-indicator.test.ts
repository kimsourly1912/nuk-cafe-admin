import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { REFRESH_MIN_SHOWN, REFRESH_SHOW_DELAY, useRefreshIndicator } from '~/composables/useRefreshIndicator'

function setup(initial = false) {
  const refreshing = ref(initial)
  const scope = effectScope()
  const shown = scope.run(() => useRefreshIndicator(refreshing))!
  /** Sets `refreshing` and lets the watcher run. */
  const set = async (value: boolean) => {
    refreshing.value = value
    await nextTick()
  }
  return { shown, set, scope }
}

describe('useRefreshIndicator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a refresh shorter than the delay shows nothing (no flash)', async () => {
    const { shown, set } = setup()
    await set(true)
    vi.advanceTimersByTime(REFRESH_SHOW_DELAY - 1)
    await set(false)
    vi.advanceTimersByTime(1000)
    expect(shown.value).toBe(false)
  })

  it('shows after the delay, and stays the minimum time even when the refresh ends at once', async () => {
    const { shown, set } = setup()
    await set(true)
    vi.advanceTimersByTime(REFRESH_SHOW_DELAY)
    expect(shown.value).toBe(true)
    await set(false)
    vi.advanceTimersByTime(REFRESH_MIN_SHOWN - 1)
    expect(shown.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(shown.value).toBe(false)
  })

  it('a long refresh hides as soon as it ends', async () => {
    const { shown, set } = setup()
    await set(true)
    vi.advanceTimersByTime(REFRESH_SHOW_DELAY + REFRESH_MIN_SHOWN + 500)
    await set(false)
    expect(shown.value).toBe(false)
  })

  it('a new refresh while hiding keeps it shown (typing: no blink between requests)', async () => {
    const { shown, set } = setup()
    await set(true)
    vi.advanceTimersByTime(REFRESH_SHOW_DELAY)
    await set(false)
    vi.advanceTimersByTime(REFRESH_MIN_SHOWN / 2)
    await set(true)
    vi.advanceTimersByTime(REFRESH_MIN_SHOWN * 2)
    expect(shown.value).toBe(true)
  })

  it('already refreshing when created: shows after the delay', () => {
    const { shown } = setup(true)
    vi.advanceTimersByTime(REFRESH_SHOW_DELAY)
    expect(shown.value).toBe(true)
  })

  it('stopping the scope clears the timer', async () => {
    const { shown, set, scope } = setup()
    await set(true)
    scope.stop()
    vi.advanceTimersByTime(1000)
    expect(shown.value).toBe(false)
  })
})
