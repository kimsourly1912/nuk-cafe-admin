import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { ApiError } from '../../app/utils/api-error'
import type { MutationOptions } from '../../app/utils/mutation'
import { createMutation, createMutationState } from '../../app/utils/mutation'

interface Item { id: number, name: string, parentId?: number }

/** A promise we resolve/reject by hand, to control timing. */
function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise(r => setTimeout(r, 0))
const notFound = () => ApiError.fromResponse(200, { success: false, msg: 'NC0011', reason: 'Category not found' })

function setup(fn: (item: Item) => Promise<unknown>, options: Partial<MutationOptions<Item, unknown>> = {}, confirmAnswer = true) {
  const state = reactive(createMutationState<Item, unknown>())
  const progress = { update: vi.fn(), close: vi.fn() }
  let stop = () => {}
  const deps = {
    state,
    confirm: vi.fn(async () => confirmAnswer),
    success: vi.fn(),
    failure: vi.fn(),
    progress: vi.fn((_title: string, onStop: () => void) => {
      stop = onStop
      return progress
    }),
    invalidate: vi.fn(async () => {}),
    onPendingChange: vi.fn(),
  }
  const mutation = createMutation(fn, {
    key: item => item.id,
    successMessage: item => `Deleted ${(item as unknown as Item)?.name ?? ''}`.trim(),
    errorMessage: item => `Could not delete "${item.name}"`,
    invalidate: ['categories'],
    removes: true,
    batch: { noun: ['category', 'categories'], verb: ['Deleting', 'deleted'], concurrency: 2 },
    ...options,
  }, deps)
  return { mutation, deps, state, progress, stop: () => stop() }
}

const a = { id: 1, name: 'A' }
const b = { id: 2, name: 'B' }
const c = { id: 3, name: 'C' }

describe('execute (single item)', () => {
  it('runs different items concurrently and tracks each one', async () => {
    const calls = new Map<number, ReturnType<typeof deferred>>()
    const { mutation } = setup((item) => {
      const d = deferred()
      calls.set(item.id, d)
      return d.promise
    })

    const pa = mutation.execute(a)
    const pb = mutation.execute(b)
    await tick()
    expect(mutation.isPending(1)).toBe(true)
    expect(mutation.isPending(2)).toBe(true)
    expect(mutation.pendingCount()).toBe(2)

    calls.get(2)!.resolve()
    await pb
    expect(mutation.isPending(2)).toBe(false)
    expect(mutation.isPending(1)).toBe(true)

    calls.get(1)!.resolve()
    await expect(pa).resolves.toMatchObject({ ok: true })
    expect(mutation.isPending()).toBe(false)
  })

  it('skips a second call for an item already in flight (no double submit)', async () => {
    const d = deferred()
    const fn = vi.fn(() => d.promise)
    const { mutation } = setup(fn)
    const first = mutation.execute(a)
    await tick()
    await expect(mutation.execute(a)).resolves.toEqual({ ok: false, status: 'skipped' })
    d.resolve()
    await first
    expect(fn).toHaveBeenCalledOnce()
  })

  it('returns cancelled and does nothing when the user declines', async () => {
    const fn = vi.fn(async () => {})
    const { mutation, deps } = setup(fn, { confirm: () => ({ title: 'Delete?' }) }, false)
    await expect(mutation.execute(a)).resolves.toEqual({ ok: false, status: 'cancelled' })
    expect(fn).not.toHaveBeenCalled()
    expect(deps.success).not.toHaveBeenCalled()
  })

  it('never throws: records the error per item and toasts it', async () => {
    const { mutation, deps } = setup(async () => {
      throw notFound()
    })
    const result = await mutation.execute(a)
    expect(result).toMatchObject({ ok: false, status: 'error', error: { kind: 'not_found' } })
    expect(mutation.errorOf(1)?.message).toBe('Category not found')
    expect(mutation.errorOf(2)).toBeUndefined()
    expect(deps.failure).toHaveBeenCalledWith('Could not delete "A"', 'Category not found', undefined)
  })

  it('does not toast silent errors (session expired)', async () => {
    const { mutation, deps } = setup(async () => {
      throw ApiError.fromResponse(401, { success: false, msg: 'NC1000', reason: 'Unauthorized' })
    })
    await mutation.execute(a)
    expect(deps.failure).not.toHaveBeenCalled()
  })

  it('adds error actions decided at failure time (e.g. Reopen)', async () => {
    const { mutation, deps } = setup(async () => {
      throw notFound()
    })
    const reopen = { label: 'Reopen', onClick: () => {} }
    await mutation.execute(a, { errorActions: () => [reopen] })
    expect(deps.failure).toHaveBeenCalledWith(expect.any(String), expect.any(String), [reopen])
  })

  it('marks removed items until the refresh lands, then clears them', async () => {
    const refresh = deferred()
    const { mutation, deps } = setup(async () => {})
    deps.invalidate.mockReturnValueOnce(refresh.promise)
    await mutation.execute(a)
    expect(deps.invalidate).toHaveBeenCalledWith(['categories'])
    expect(mutation.isRemoved(1)).toBe(true)
    refresh.resolve()
    await tick()
    expect(mutation.isRemoved(1)).toBe(false)
  })

  it('reports pending changes for the leave-page guard', async () => {
    const { mutation, deps } = setup(async () => {})
    await mutation.execute(a)
    expect(deps.onPendingChange.mock.calls).toEqual([[1], [-1]])
  })

  it('without a key, runs one call at a time', async () => {
    const d = deferred()
    const { mutation } = setup(() => d.promise, { key: undefined })
    const first = mutation.execute(a)
    await tick()
    await expect(mutation.execute(b)).resolves.toMatchObject({ status: 'skipped' })
    expect(mutation.isPending()).toBe(true)
    d.resolve()
    await first
  })
})

describe('executeMany (batch)', () => {
  it('limits concurrency', async () => {
    let active = 0
    let maxActive = 0
    const { mutation } = setup(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await tick()
      active--
    })
    const result = await mutation.executeMany([a, b, c, { id: 4, name: 'D' }, { id: 5, name: 'E' }])
    expect(result.succeeded).toHaveLength(5)
    expect(maxActive).toBe(2)
  })

  it('confirms once, refreshes once and shows one summary', async () => {
    const { mutation, deps } = setup(async () => {}, {
      batch: { noun: ['category', 'categories'], verb: ['Deleting', 'deleted'], confirm: items => ({ title: `Delete ${items.length}?` }) },
    })
    await mutation.executeMany([a, b, c])
    expect(deps.confirm).toHaveBeenCalledOnce()
    expect(deps.confirm).toHaveBeenCalledWith({ title: 'Delete 3?' })
    expect(deps.invalidate).toHaveBeenCalledOnce()
    expect(deps.success).toHaveBeenCalledOnce()
    expect(deps.success).toHaveBeenCalledWith('3 categories deleted', undefined)
  })

  it('reports partial failure with grouped reasons and a working "Retry failed"', async () => {
    let attempt = 0
    const { mutation, deps } = setup(async (item) => {
      if (item.id !== 1 && attempt++ < 2) throw notFound()
    })
    const result = await mutation.executeMany([a, b, c])
    expect(result.succeeded.map(s => s.input.id)).toEqual([1])
    expect(result.failed.map(f => f.input.id).sort()).toEqual([2, 3])
    const [title, description, actions] = deps.failure.mock.calls[0]!
    expect(title).toBe('1 category deleted, 2 failed')
    expect(description).toBe('Category not found (2)')

    actions![0]!.onClick() // Retry failed: no second confirmation, only the failed items
    await tick()
    await tick()
    expect(deps.success).toHaveBeenLastCalledWith('2 categories deleted', undefined)
  })

  it('skips items already in flight from a single action', async () => {
    const d = deferred()
    const { mutation } = setup(item => (item.id === 1 ? d.promise : Promise.resolve()))
    const single = mutation.execute(a)
    await tick()
    const result = await mutation.executeMany([a, b])
    expect(result.skipped).toEqual([a])
    expect(result.succeeded.map(s => s.input)).toEqual([b])
    d.resolve()
    await single
  })

  it('Stop leaves unstarted items alone', async () => {
    const gates: ReturnType<typeof deferred>[] = []
    const fn = vi.fn(() => {
      const d = deferred()
      gates.push(d)
      return d.promise
    })
    const { mutation, stop, progress } = setup(fn, {
      batch: { noun: ['category', 'categories'], verb: ['Deleting', 'deleted'], concurrency: 1 },
    })
    const running = mutation.executeMany([a, b, c])
    await tick()
    stop() // while A is in flight
    gates[0]!.resolve()
    const result = await running
    expect(fn).toHaveBeenCalledOnce()
    expect(result.succeeded.map(s => s.input)).toEqual([a])
    expect(result.notStarted).toEqual([b, c])
    expect(progress.close).toHaveBeenCalled()
  })

  it('runs phases in order (children before parents)', async () => {
    const order: number[] = []
    const parent = { id: 10, name: 'Coffee' }
    const child = { id: 11, name: 'Latte', parentId: 10 }
    const { mutation } = setup(async (item) => {
      await tick()
      order.push(item.id)
    }, {
      batch: {
        noun: ['category', 'categories'],
        verb: ['Deleting', 'deleted'],
        phases: items => [items.filter(i => i.parentId), items.filter(i => !i.parentId)],
      },
    })
    await mutation.executeMany([parent, child])
    expect(order).toEqual([11, 10])
  })

  it('does nothing when the user declines the batch', async () => {
    const fn = vi.fn(async () => {})
    const { mutation } = setup(fn, { batch: { noun: ['c', 'cs'], verb: ['D', 'd'], confirm: () => ({ title: 'x' }) } }, false)
    const result = await mutation.executeMany([a, b])
    expect(result.cancelled).toBe(true)
    expect(fn).not.toHaveBeenCalled()
  })
})
