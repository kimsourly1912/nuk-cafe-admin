import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOrderAutosave } from '../utils/order-autosave'

/** A save whose answer the test gives, one request at a time. */
function server() {
  const sent: string[][] = []
  const answers: ((ok: boolean) => void)[] = []
  const save = (order: string[]) => {
    sent.push(order)
    return new Promise<boolean>(resolve => answers.push(resolve))
  }
  const answer = async (ok = true) => {
    answers.shift()!(ok)
    await vi.advanceTimersByTimeAsync(0)
  }
  return { sent, save, answer }
}

describe('order autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one request with the latest order after the last move', async () => {
    const api = server()
    const autosave = createOrderAutosave({ delay: 500, save: api.save, onFailed: vi.fn() })
    autosave.schedule(['b', 'a', 'c'])
    await vi.advanceTimersByTimeAsync(400)
    autosave.schedule(['b', 'c', 'a'])
    await vi.advanceTimersByTimeAsync(400)
    expect(api.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    expect(api.sent).toEqual([['b', 'c', 'a']])
    expect(autosave.isPending()).toBe(true)
    await api.answer()
    expect(autosave.isPending()).toBe(false)
  })

  it('never overlaps requests: moves made while saving are sent after the answer', async () => {
    const api = server()
    const autosave = createOrderAutosave({ delay: 500, save: api.save, onFailed: vi.fn() })
    autosave.schedule(['b', 'a'])
    await vi.advanceTimersByTimeAsync(500)
    autosave.schedule(['a', 'b'])
    await vi.advanceTimersByTimeAsync(500)
    expect(api.sent).toEqual([['b', 'a']])
    await api.answer()
    expect(api.sent).toEqual([['b', 'a'], ['a', 'b']])
    await api.answer()
    expect(autosave.isPending()).toBe(false)
  })

  it('drops waiting moves after a failure and asks to put back the saved order', async () => {
    const api = server()
    const onFailed = vi.fn()
    const autosave = createOrderAutosave({ delay: 500, save: api.save, onFailed })
    autosave.schedule(['b', 'a', 'c'])
    await vi.advanceTimersByTimeAsync(500)
    autosave.schedule(['b', 'c', 'a'])
    await api.answer(false)
    expect(onFailed).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.sent).toEqual([['b', 'a', 'c']])
    expect(autosave.isPending()).toBe(false)
  })

  it('flush sends at once and resolves after every answer', async () => {
    const api = server()
    const autosave = createOrderAutosave({ delay: 500, save: api.save, onFailed: vi.fn() })
    autosave.schedule(['b', 'a'])
    let done = false
    const flushed = autosave.flush().then(() => (done = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.sent).toEqual([['b', 'a']])
    expect(done).toBe(false)
    await api.answer()
    await flushed
    expect(done).toBe(true)
  })

  it('reports whether anything is waiting or saving', async () => {
    const api = server()
    const onChange = vi.fn()
    const autosave = createOrderAutosave({ delay: 500, save: api.save, onFailed: vi.fn(), onChange })
    autosave.schedule(['b', 'a'])
    expect(onChange).toHaveBeenLastCalledWith(true)
    await vi.advanceTimersByTimeAsync(500)
    await api.answer()
    expect(onChange).toHaveBeenLastCalledWith(false)
    autosave.schedule(['a', 'b'])
    autosave.cancel()
    expect(onChange).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.sent).toHaveLength(1)
  })
})
