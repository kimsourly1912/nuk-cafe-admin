import { computed, effectScope, nextTick, ref, shallowRef, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The composable's Nuxt and Vue auto-imports, stubbed: plain Node has none (one `useState` per key).
const states = new Map<string, unknown>()
vi.stubGlobal('useState', (key: string, init: () => unknown) => {
  if (!states.has(key)) states.set(key, ref(init()))
  return states.get(key)
})
vi.stubGlobal('shallowRef', shallowRef)
vi.stubGlobal('computed', computed)
vi.stubGlobal('watch', watch)
// VueUse starts no timer without a browser (`isClient`), which would hide an always-on one.
vi.stubGlobal('window', globalThis)
vi.stubGlobal('document', {})

const { RESEND_COOLDOWN_SECONDS, useResendCooldown } = await import('../composables/useCustomerAccount')

describe('useResendCooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    states.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const scope = effectScope()
    const cooldown = scope.run(() => useResendCooldown('verify'))!
    return { scope, cooldown }
  }

  it('runs no timer until an email is sent (the banner is on every menu page)', () => {
    const { scope, cooldown } = setup()
    expect(vi.getTimerCount()).toBe(0)
    expect(cooldown.waiting.value).toBe(false)
    expect(cooldown.waitLabel('Resend email')).toBe('Resend email')
    scope.stop()
  })

  it('counts down after a send, then stops its timer', async () => {
    const { scope, cooldown } = setup()
    cooldown.start()
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    expect(cooldown.waitLabel('Resend email')).toBe(`Resend email in ${RESEND_COOLDOWN_SECONDS} s`)

    vi.advanceTimersByTime(1000)
    expect(cooldown.waitLabel('Resend email')).toBe(`Resend email in ${RESEND_COOLDOWN_SECONDS - 1} s`)

    vi.advanceTimersByTime(RESEND_COOLDOWN_SECONDS * 1000)
    expect(cooldown.waiting.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })

  it('shares one wait between every place that offers the email', async () => {
    const first = setup()
    first.cooldown.start()
    await nextTick()
    const second = setup()
    expect(second.cooldown.waiting.value).toBe(true)
    first.scope.stop()
    second.scope.stop()
  })
})
