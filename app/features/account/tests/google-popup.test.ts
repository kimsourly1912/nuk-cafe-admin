import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { ApiError } from '~/utils/api-error'
import { useAuthCompletion } from '~/composables/useAuthCompletion'
import { useGoogleSignInPopup } from '../composables/useGoogleSignInPopup'

const actions = vi.hoisted(() => ({ googleSignIn: vi.fn(), finishSignIn: vi.fn() }))
vi.mock('../composables/useCustomerAccount', () => ({ useAccountActions: () => actions }))

describe('Google popup lifecycle', () => {
  let scope: ReturnType<typeof effectScope>
  let popup: { closed: boolean, opener: unknown, document: { title: string, body: { textContent: string } }, location: { href: string, replace: (destination: string) => void }, close: () => void }
  let identity: { generation: Ref<number>, assertCurrent: (generation: number) => void, change: () => void }
  let channel: { onmessage: ((event: MessageEvent) => void) | null, postMessage: (message: unknown) => void, close: () => void }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    scope = effectScope()
    identity = {
      generation: ref(0),
      assertCurrent: (generation) => {
        if (generation !== identity.generation.value) throw new ApiError('Stale identity.', { kind: 'aborted', status: 0 })
      },
      change: vi.fn(() => { identity.generation.value++ }),
    }
    popup = { closed: false, opener: {}, document: { title: '', body: { textContent: '' } }, location: { href: 'about:blank', replace: vi.fn() }, close: vi.fn(() => {
      popup.closed = true
    }) }
    vi.stubGlobal('window', { location: { origin: 'https://cafe.test' }, open: vi.fn(() => popup) })
    vi.stubGlobal('BroadcastChannel', vi.fn(function () {
      channel = { onmessage: null, postMessage: vi.fn(), close: vi.fn(() => {
        channel.onmessage = null
      }) }
      return channel
    }))
    vi.stubGlobal('ApiError', ApiError)
    vi.stubGlobal('apiFetch', vi.fn().mockResolvedValue({ user: { id: 'google-user' } }))
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('onScopeDispose', onScopeDispose)
    vi.stubGlobal('useAuthCompletion', useAuthCompletion)
    vi.stubGlobal('useSessionIdentity', () => identity)
    actions.googleSignIn.mockResolvedValue('https://accounts.google.com/authorize')
    actions.finishSignIn.mockResolvedValue(undefined)
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function start() {
    const flow = scope.run(useGoogleSignInPopup)!
    const completion = flow.open('/c/example/checkout')
    return { flow, completion }
  }

  function callback(origin = 'https://cafe.test', path = '/google-callback', attempt?: string) {
    const id = attempt ?? actions.googleSignIn.mock.calls[0]![1]
    channel.onmessage?.({ origin, data: { type: 'google-complete', path, attempt: id, success: true } } as MessageEvent)
  }

  it('ignores another origin, path or attempt before verifying the session and announcing login', async () => {
    const { completion } = start()
    for (const [origin, path, attempt] of [
      ['https://other.test', '/google-callback', undefined],
      ['https://cafe.test', '/sign-up', undefined],
      ['https://cafe.test', '/google-callback', 'another-attempt'],
    ]) {
      callback(origin, path, attempt)
      await vi.advanceTimersByTimeAsync(250)
      expect(actions.finishSignIn).not.toHaveBeenCalled()
      expect(identity.change).not.toHaveBeenCalled()
    }
    callback()
    await vi.advanceTimersByTimeAsync(250)
    await completion
    expect(actions.finishSignIn).toHaveBeenCalledOnce()
    expect(identity.change).toHaveBeenCalledWith('login', 'account')
    expect(popup.closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['scope', 'identity'])('cancels a held initiation on %s change and never navigates its later result', async (change) => {
    let release!: (destination: string) => void
    actions.googleSignIn.mockReturnValue(new Promise<string>((resolve) => {
      release = resolve
    }))
    const { completion } = start()
    const refused = expect(completion).rejects.toMatchObject({ kind: 'aborted' })
    if (change === 'scope') scope.stop()
    else identity.generation.value++
    await refused
    release('https://accounts.google.com/authorize')
    await vi.advanceTimersByTimeAsync(250)
    expect(popup.closed).toBe(true)
    expect(popup.location.replace).not.toHaveBeenCalled()
    expect(actions.finishSignIn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('closing the popup settles even while initiation is still pending', async () => {
    actions.googleSignIn.mockReturnValue(new Promise(() => {}))
    const { flow, completion } = start()
    const refused = expect(completion).rejects.toThrow('Google sign-in was closed.')
    popup.close()
    await vi.advanceTimersByTimeAsync(250)
    await refused
    expect(flow.pending.value).toBe(false)
    expect(identity.change).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for the code without checking a session or announcing login', async () => {
    const { completion } = start()
    const attempt = actions.googleSignIn.mock.calls[0]![1]
    channel.onmessage?.({ origin: 'https://cafe.test', data: { type: 'google-complete', path: '/google-callback', attempt, success: true, twoFactor: true } } as MessageEvent)
    await expect(completion).resolves.toBe('two-factor')
    expect(actions.finishSignIn).not.toHaveBeenCalled()
    expect(identity.change).not.toHaveBeenCalled()
    expect(popup.closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards an account change while its own login announcement is still pending', async () => {
    let release!: () => void
    identity.change = vi.fn(() => {
      identity.generation.value++
      return new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const { completion } = start()
    const refused = expect(completion).rejects.toMatchObject({ kind: 'aborted' })
    callback()
    await vi.advanceTimersByTimeAsync(250)
    identity.generation.value++
    expect(popup.closed).toBe(true)
    release()
    await refused
    expect(actions.finishSignIn).not.toHaveBeenCalled()
  })

  it('does not treat an existing guest cookie as completed account sign-in', async () => {
    const { useAccountActions } = await vi.importActual<typeof import('../composables/useCustomerAccount')>('../composables/useCustomerAccount')
    vi.stubGlobal('useAuthRequest', () => vi.fn())
    vi.stubGlobal('apiFetch', vi.fn().mockResolvedValue({ user: { id: 'guest', isAnonymous: true, name: 'Guest', email: '' } }))
    const account = scope.run(useAccountActions)!
    await expect(account.finishSignIn()).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(identity.change).not.toHaveBeenCalled()
  })

  it('closes the popup immediately when leaving during the final session check', async () => {
    let release!: () => void
    actions.finishSignIn.mockReturnValue(new Promise<void>((resolve) => {
      release = resolve
    }))
    const { completion } = start()
    callback()
    await vi.advanceTimersByTimeAsync(250)
    const refused = expect(completion).rejects.toMatchObject({ kind: 'aborted' })
    scope.stop()
    const closedOnDeparture = popup.closed
    release()
    await refused
    expect(closedOnDeparture).toBe(true)
    expect(identity.change).toHaveBeenCalledOnce()
  })
})
