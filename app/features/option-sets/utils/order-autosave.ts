/**
 * Saves a list's order shortly after the user stops moving things (D73): each move restarts a short
 * timer, and when it runs out the latest order is sent in one request. Requests never overlap (each
 * sends the version the previous answer returned): moves made while one is saving are sent after it.
 * A failed save drops the moves still waiting, and `onFailed` puts back the last saved order.
 *
 * Framework-free so the timing rules are unit-tested with fake timers.
 *
 * @example
 * const autosave = createOrderAutosave({ delay: 500, save: ids => saveOrder(ids), onFailed: revert, onChange: busy => (saving.value = busy) })
 * autosave.schedule(['b', 'a', 'c'])
 * await autosave.flush() // "Done": send now and wait
 */
export interface OrderAutosaveOptions {
  /** Milliseconds after the last move. */
  delay: number
  /** Sends the order; resolves `true` when saved. Must not reject. */
  save: (order: string[]) => Promise<boolean>
  /** A save failed: the waiting moves were dropped; put back the last saved order. */
  onFailed: () => void
  /** Whether anything is waiting or saving, on every change. */
  onChange?: (pending: boolean) => void
}

export function createOrderAutosave(options: OrderAutosaveOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let next: string[] | undefined
  let running: Promise<void> | undefined

  const isPending = () => Boolean(timer || next || running)
  const changed = () => options.onChange?.(isPending())

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  async function run(): Promise<void> {
    clearTimer()
    if (running) {
      // One request at a time: send what's waiting once this one answered.
      await running
      return run()
    }
    if (!next) return changed()
    const order = next
    next = undefined
    running = options.save(order).then((ok) => {
      running = undefined
      if (!ok) {
        next = undefined
        clearTimer()
        options.onFailed()
      }
      changed()
    })
    changed()
    await running
  }

  /** The order changed: send it once no other move follows within `delay`. */
  function schedule(order: string[]) {
    next = [...order]
    clearTimer()
    timer = setTimeout(() => void run(), options.delay)
    changed()
  }

  /** Sends what's waiting now, and resolves when every request has answered. */
  function flush() {
    return run()
  }

  /** Drops what's waiting (not a request already sent). */
  function cancel() {
    clearTimer()
    next = undefined
    changed()
  }

  return { schedule, flush, cancel, isPending }
}
