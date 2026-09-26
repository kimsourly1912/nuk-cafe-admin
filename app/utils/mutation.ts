import { ApiError, isSilentError } from './api-error'

/**
 * Framework-agnostic mutation engine behind `useMutation` (app/composables/useMutation.ts).
 * Kept free of Nuxt so the concurrency rules are unit-tested in plain Node
 * (test/unit/mutation.test.ts). UI and data refresh are injected as `MutationDeps`.
 */

export type MutationKey = string | number

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
}

export interface ToastAction {
  label: string
  onClick: () => void
}

export type MutationResult<T>
  = | { ok: true, status: 'success', data: T }
    | { ok: false, status: 'error', error: ApiError }
    /** `cancelled`: the user declined the confirmation. `skipped`: the same item is already in flight. */
    | { ok: false, status: 'cancelled' | 'skipped' }

export interface BatchResult<TInput, TResult> {
  succeeded: { input: TInput, data: TResult }[]
  failed: { input: TInput, error: ApiError }[]
  /** Already in flight when the batch started (e.g. a single delete on the same row). */
  skipped: TInput[]
  /** Never started because the user pressed Stop. */
  notStarted: TInput[]
  /** The user declined the batch confirmation; nothing ran. */
  cancelled: boolean
}

type MaybeFn<T, A extends unknown[]> = T | ((...args: A) => T)

export interface MutationOptions<TInput, TResult> {
  /**
   * Identifies the item a call acts on. Calls with different keys run concurrently; a call whose
   * key is already in flight is skipped (no double submit). Omit for "one at a time" (e.g. create).
   */
  key?: (input: TInput) => MutationKey
  /** Ask before running (e.g. deletes). */
  confirm?: MaybeFn<ConfirmOptions, [input: TInput]>
  /** Toast title on success. `false` for no toast. */
  successMessage?: MaybeFn<string, [data: TResult, input: TInput]> | false
  /** Toast title on failure; the description is the ApiError's user-safe message. */
  errorMessage?: MaybeFn<string, [input: TInput]>
  /** Features whose cached data to refresh after success (see `invalidate`). */
  invalidate?: string[]
  /** Success removes the item: `isRemoved(key)` is true until the refreshed data arrives. */
  removes?: boolean
  onSuccess?: (data: TResult, input: TInput) => void
  onError?: (error: ApiError, input: TInput) => void
  batch?: {
    /** e.g. ['category', 'categories'] */
    noun: [singular: string, plural: string]
    /** e.g. ['Deleting', 'deleted'] */
    verb: [progressive: string, past: string]
    /** Max requests in flight at once. Default 4. */
    concurrency?: number
    /** Ask once before the batch (receives the items that will actually run). */
    confirm?: (inputs: TInput[]) => ConfirmOptions
    /**
     * Split items into phases that run one after another, e.g. delete sub-categories before
     * their parents. Default: a single phase.
     */
    phases?: (inputs: TInput[]) => TInput[][]
  }
}

export interface ExecuteOverrides<TInput> {
  /** Override or skip (`false`) the confirmation for this call. */
  confirm?: ConfirmOptions | false
  /** Extra actions on the error toast, decided when the error happens (e.g. "Reopen"). */
  errorActions?: (error: ApiError, input: TInput) => ToastAction[]
}

/** Reactive state shared by every component using the same mutation id. */
export interface MutationState<TInput = unknown, TResult = unknown> {
  inFlight: Record<string, TInput>
  errors: Record<string, ApiError>
  removed: Record<string, true>
  lastResult: TResult | undefined
  lastError: ApiError | undefined
}

export function createMutationState<TInput, TResult>(): MutationState<TInput, TResult> {
  return { inFlight: {}, errors: {}, removed: {}, lastResult: undefined, lastError: undefined }
}

export interface ProgressHandle {
  update: (title: string) => void
  close: () => void
}

export interface MutationDeps<TInput, TResult> {
  /** Must be reactive (e.g. `useState(...).value`) for the UI to follow it. */
  state: MutationState<TInput, TResult>
  confirm: (options: ConfirmOptions) => Promise<boolean>
  success: (title: string, description?: string) => void
  failure: (title: string, description?: string, actions?: ToastAction[]) => void
  progress: (title: string, onStop: () => void) => ProgressHandle
  invalidate: (features: string[]) => Promise<void>
  /** +1 when a call starts, -1 when it ends (drives the leave-page warning). */
  onPendingChange?: (delta: number) => void
}

const SINGLE = '__single__'

/** Removes a key from a (reactive) record; Vue tracks `deleteProperty`. */
function forget(record: Record<string, unknown>, key: string) {
  Reflect.deleteProperty(record, key)
}

function resolve<T, A extends unknown[]>(value: MaybeFn<T, A> | undefined, ...args: A): T | undefined {
  return typeof value === 'function' ? (value as (...a: A) => T)(...args) : value
}

export function createMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  options: MutationOptions<TInput, TResult>,
  deps: MutationDeps<TInput, TResult>,
) {
  const { state } = deps
  const keyOf = (input: TInput) => (options.key ? String(options.key(input)) : SINGLE)
  const toKey = (key: MutationKey | undefined) => (key === undefined ? SINGLE : String(key))

  /** Refresh affected data; hide removed keys until the refresh has landed. */
  function refreshAfter(removedKeys: string[]) {
    if (!options.invalidate?.length) return
    deps.invalidate(options.invalidate)
      .catch(() => {})
      .finally(() => {
        for (const key of removedKeys) forget(state.removed, key)
      })
  }

  /** Runs one call: tracks in-flight state, records result/error. Toasts only if `notify`. */
  async function run(
    input: TInput,
    notify: boolean,
    overrides: ExecuteOverrides<TInput> = {},
  ): Promise<MutationResult<TResult>> {
    const key = keyOf(input)
    if (key in state.inFlight) return { ok: false, status: 'skipped' }

    state.inFlight[key] = input
    forget(state.errors, key)
    deps.onPendingChange?.(1)
    try {
      const data = await fn(input)
      state.lastResult = data
      state.lastError = undefined
      if (options.removes) state.removed[key] = true
      if (notify) {
        const title = options.successMessage === false ? undefined : resolve(options.successMessage, data, input)
        if (title) deps.success(title)
      }
      options.onSuccess?.(data, input)
      return { ok: true, status: 'success', data }
    }
    catch (thrown) {
      const error = ApiError.from(thrown)
      state.errors[key] = error
      state.lastError = error
      if (notify && !isSilentError(error)) {
        const title = resolve(options.errorMessage, input) ?? 'Something went wrong'
        deps.failure(title, error.message, overrides.errorActions?.(error, input))
      }
      options.onError?.(error, input)
      return { ok: false, status: 'error', error }
    }
    finally {
      forget(state.inFlight, key)
      deps.onPendingChange?.(-1)
    }
  }

  /**
   * Confirm (if configured) → call → toast → refresh. Never throws; inspect the result.
   * A second call for an item already in flight resolves to `skipped`.
   */
  async function execute(input: TInput, overrides: ExecuteOverrides<TInput> = {}): Promise<MutationResult<TResult>> {
    if (keyOf(input) in state.inFlight) return { ok: false, status: 'skipped' }

    const confirmOptions = overrides.confirm === false ? undefined : overrides.confirm ?? resolve(options.confirm, input)
    if (confirmOptions && !(await deps.confirm(confirmOptions))) return { ok: false, status: 'cancelled' }

    const result = await run(input, true, overrides)
    if (result.ok) refreshAfter(options.removes ? [keyOf(input)] : [])
    return result
  }

  /**
   * Runs the mutation for many items with limited concurrency, one confirmation,
   * a live progress toast with Stop, one summary toast and one data refresh.
   */
  async function executeMany(inputs: TInput[], overrides: Pick<ExecuteOverrides<TInput>, 'confirm'> = {}): Promise<BatchResult<TInput, TResult>> {
    const batch = options.batch
    const result: BatchResult<TInput, TResult> = { succeeded: [], failed: [], skipped: [], notStarted: [], cancelled: false }

    const runnable = inputs.filter((input) => {
      const busy = keyOf(input) in state.inFlight
      if (busy) result.skipped.push(input)
      return !busy
    })
    if (!runnable.length) return result

    const confirmOptions = overrides.confirm === false ? undefined : overrides.confirm ?? batch?.confirm?.(runnable)
    if (confirmOptions && !(await deps.confirm(confirmOptions))) {
      result.cancelled = true
      return result
    }

    const [one, many] = batch?.noun ?? ['item', 'items']
    const [doing, done] = batch?.verb ?? ['Processing', 'processed']
    const noun = (n: number) => (n === 1 ? one : many)
    const total = runnable.length
    let finished = 0
    let stopped = false

    const progress = deps.progress(`${doing} ${noun(total)}… 0/${total}`, () => {
      stopped = true
    })

    const phases = batch?.phases?.(runnable).filter(p => p.length) ?? [runnable]
    for (const phase of phases) {
      let next = 0
      const worker = async () => {
        while (next < phase.length && !stopped) {
          const input = phase[next++]!
          const outcome = await run(input, false)
          if (outcome.ok) result.succeeded.push({ input, data: outcome.data })
          else if (outcome.status === 'error') result.failed.push({ input, error: outcome.error })
          else result.skipped.push(input) // became busy after the batch started
          finished++
          progress.update(`${doing} ${noun(total)}… ${finished}/${total}`)
        }
      }
      await Promise.all(Array.from({ length: Math.min(batch?.concurrency ?? 4, phase.length) }, worker))
      if (stopped) result.notStarted.push(...phase.slice(next))
      if (stopped) {
        // Remaining phases never start either.
        for (const later of phases.slice(phases.indexOf(phase) + 1)) result.notStarted.push(...later)
        break
      }
    }
    progress.close()

    const ok = result.succeeded.length
    const extras = [
      result.skipped.length ? `${result.skipped.length} skipped (already in progress)` : '',
      result.notStarted.length ? `${result.notStarted.length} not started (stopped)` : '',
    ].filter(Boolean)

    if (result.failed.length) {
      // Group identical reasons: "Category not found (2) · Can't reach the server (1)".
      const reasons = new Map<string, number>()
      for (const { error } of result.failed) reasons.set(error.message, (reasons.get(error.message) ?? 0) + 1)
      const description = [...reasons].map(([message, count]) => `${message} (${count})`).concat(extras).join(' · ')
      const failedInputs = result.failed.map(f => f.input)
      deps.failure(
        `${ok} ${noun(ok)} ${done}, ${result.failed.length} failed`,
        description,
        [{ label: 'Retry failed', onClick: () => void executeMany(failedInputs, { confirm: false }) }],
      )
    }
    else if (ok || extras.length) {
      deps.success(`${ok} ${noun(ok)} ${done}`, extras.join(' · ') || undefined)
    }

    if (ok) refreshAfter(options.removes ? result.succeeded.map(s => keyOf(s.input)) : [])
    return result
  }

  return {
    execute,
    executeMany,
    /** Without a key: whether any call of this mutation is in flight. */
    isPending: (key?: MutationKey) => (key === undefined ? Object.keys(state.inFlight).length > 0 : toKey(key) in state.inFlight),
    pendingCount: () => Object.keys(state.inFlight).length,
    /** Last error for an item (or for the single slot when the mutation has no key). */
    errorOf: (key?: MutationKey) => state.errors[toKey(key)],
    /** True after a successful `removes` call until the refreshed data arrives. */
    isRemoved: (key: MutationKey) => toKey(key) in state.removed,
    /** Clears recorded errors/results (e.g. when a form reopens). */
    reset: (key?: MutationKey) => {
      if (key === undefined) {
        for (const k of Object.keys(state.errors)) forget(state.errors, k)
        state.lastError = undefined
        state.lastResult = undefined
      }
      else {
        forget(state.errors, toKey(key))
      }
    },
  }
}

export type Mutation<TInput, TResult> = ReturnType<typeof createMutation<TInput, TResult>>
