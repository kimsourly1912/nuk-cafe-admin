import { describe, expect, it, vi } from 'vitest'
import { computed, reactive } from 'vue'
import { ApiError } from '../../app/utils/api-error'
import type { MutationOptions } from '../../app/utils/mutation'
import { createMutation, createMutationState, createRecord, LOCKED_MESSAGE } from '../../app/utils/mutation'

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
const notFound = () => ApiError.fromResponse(404, { statusCode: 404, message: 'Category not found', data: { code: 'NOT_FOUND', message: 'Category not found' } })

function setup(fn: (item: Item) => Promise<unknown>, options: Partial<MutationOptions<Item, unknown>> = {}, confirmAnswer = true) {
  const state = reactive(createMutationState<Item, unknown>())
  const progress = { update: vi.fn(), close: vi.fn() }
  let stop = () => {}
  const deps = {
    state,
    locks: reactive(createRecord<true>()),
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
    await expect(mutation.execute(a)).resolves.toEqual({ ok: false, status: 'skipped', reason: 'in-flight' })
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
      throw ApiError.fromResponse(401, { statusCode: 401, message: 'Sign in to continue.', data: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } })
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

  it('shows no success toast when the message function answers false for that call', async () => {
    const { mutation, deps } = setup(async () => {}, { successMessage: (_, item) => (item.id === 1 ? false : `Deleted ${item.name}`) })
    await mutation.execute(a)
    expect(deps.success).not.toHaveBeenCalled()
    await mutation.execute(b)
    expect(deps.success).toHaveBeenCalledWith('Deleted B')
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

describe('keys named like Object.prototype members', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    it(`runs, tracks and releases the key "${name}"`, async () => {
      const d = deferred()
      // No invalidation, so the "removed" mark stays until checked.
      const { mutation, state } = setup(() => d.promise, { key: () => name, invalidate: [] })
      expect(mutation.isPending(name)).toBe(false)
      expect(mutation.isRemoved(name)).toBe(false)
      expect(mutation.errorOf(name)).toBeUndefined()

      const first = mutation.execute(a)
      await tick()
      expect(mutation.isPending(name)).toBe(true)
      // A double submit on the same key is still skipped.
      await expect(mutation.execute(a)).resolves.toMatchObject({ status: 'skipped', reason: 'in-flight' })

      d.resolve()
      await expect(first).resolves.toMatchObject({ ok: true })
      expect(mutation.isPending(name)).toBe(false)
      expect(mutation.isRemoved(name)).toBe(true)
      // Nothing leaked onto Object.prototype.
      expect(Object.getPrototypeOf(state.inFlight)).toBeNull()
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
  }

  it('records an error under "__proto__"', async () => {
    const { mutation } = setup(async () => {
      throw notFound()
    }, { key: () => '__proto__' })
    await mutation.execute(a)
    expect(mutation.errorOf('__proto__')).toBeInstanceOf(ApiError)
  })
})

describe('reactivity', () => {
  // The UI (busy rows, removed rows, errors) reads these inside computeds and templates.
  for (const name of ['constructor', '7']) {
    it(`isPending / isRemoved / errorOf re-evaluate when the state changes (key "${name}")`, async () => {
      const d = deferred()
      const { mutation } = setup(() => d.promise, { key: () => name, invalidate: [] })
      const pending = computed(() => mutation.isPending(name))
      const removed = computed(() => mutation.isRemoved(name))
      expect(pending.value).toBe(false)
      const running = mutation.execute(a)
      await tick()
      expect(pending.value).toBe(true)
      d.resolve()
      await running
      expect(pending.value).toBe(false)
      expect(removed.value).toBe(true)
    })
  }
})

describe('record locks across mutations', () => {
  /** Two mutations (update and remove) sharing one lock registry, like useMutation does. */
  function pair() {
    const updates = new Map<number, ReturnType<typeof deferred>>()
    const removes = new Map<number, ReturnType<typeof deferred>>()
    const main = setup((item) => {
      const d = deferred()
      removes.set(item.id, d)
      return d.promise
    }, { lock: item => `category:${item.id}` })
    const update = createMutation((item: Item) => {
      const d = deferred()
      updates.set(item.id, d)
      return d.promise
    }, {
      key: item => item.id,
      lock: item => `category:${item.id}`,
      errorMessage: item => `Could not save "${item.name}"`,
    }, { ...main.deps, state: reactive(createMutationState<Item, unknown>()) })
    return { remove: main.mutation, update, deps: main.deps, updates, removes }
  }

  it('refuses a delete while an update of the same record runs, and explains why', async () => {
    const { remove, update, deps, removes } = pair()
    void update.execute(a)
    await tick()
    await expect(remove.execute(a)).resolves.toEqual({ ok: false, status: 'skipped', reason: 'locked' })
    expect(removes.size).toBe(0)
    expect(deps.failure).toHaveBeenCalledWith('Could not delete "A"', LOCKED_MESSAGE)
  })

  it('checks again after the confirmation: a lock taken while the dialog was open wins', async () => {
    const { remove, update, deps, removes } = pair()
    const answer = deferred<boolean>()
    deps.confirm.mockImplementation(() => answer.promise)
    const removing = remove.execute(a, { confirm: { title: 'Delete?' } })
    await tick()
    void update.execute(a) // starts while "Delete?" is open
    await tick()
    answer.resolve(true)
    await expect(removing).resolves.toMatchObject({ status: 'skipped', reason: 'locked' })
    expect(removes.size).toBe(0)
  })

  it('keeps different records in parallel', async () => {
    const { remove, update, removes, updates } = pair()
    void update.execute(a)
    void remove.execute(b)
    await tick()
    expect(updates.has(1)).toBe(true)
    expect(removes.has(2)).toBe(true)
  })

  it('releases the lock when the request ends, even on failure', async () => {
    const { remove, update, updates, removes } = pair()
    const saving = update.execute(a)
    await tick()
    updates.get(1)!.reject(notFound())
    await saving
    void remove.execute(a)
    await tick()
    expect(removes.has(1)).toBe(true)
  })

  it('a batch skips locked records, reports them, and runs the rest', async () => {
    const { remove, update, deps, removes } = pair()
    void update.execute(a)
    await tick()
    const batch = remove.executeMany([a, b, c])
    await tick()
    expect([...removes.keys()]).toEqual([2, 3])
    for (const d of removes.values()) d.resolve()
    const result = await batch
    expect(result.skipped).toEqual([a])
    expect(result.succeeded.map(s => s.input)).toEqual([b, c])
    expect(deps.success).toHaveBeenCalledWith('2 categories deleted', '1 skipped (another action on it was in progress)')
  })

  it('a batch item that becomes locked while queued is skipped when its turn comes', async () => {
    const { remove, update, removes } = pair()
    // concurrency 2: c waits in the queue while a and b run.
    const batch = remove.executeMany([a, b, c])
    await tick()
    expect([...removes.keys()]).toEqual([1, 2])
    void update.execute(c) // takes c's lock while it's queued
    await tick()
    removes.get(1)!.resolve()
    removes.get(2)!.resolve()
    const result = await batch
    expect(removes.has(3)).toBe(false)
    expect(result.skipped).toEqual([c])
  })

  it('a batch confirmation that is answered after a record got locked skips that record', async () => {
    const answer = deferred<boolean>()
    const { remove, update, deps, removes } = pair()
    deps.confirm.mockImplementation(() => answer.promise)
    const batch = remove.executeMany([a, b], { confirm: { title: 'Delete 2?' } })
    await tick()
    void update.execute(a) // while "Delete 2?" is open
    await tick()
    answer.resolve(true)
    await tick()
    removes.get(2)?.resolve()
    const result = await batch
    expect(removes.has(1)).toBe(false)
    expect(result.skipped).toEqual([a])
    expect(result.succeeded.map(s => s.input)).toEqual([b])
  })
})
