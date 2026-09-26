import type { MutationOptions } from '~/utils/mutation'
import { createMutation, createMutationState } from '~/utils/mutation'

/** Number of mutations in flight app-wide (drives the leave-page warning). */
export const usePendingMutationCount = () => useState('mutation:pending-count', () => 0)

/**
 * Create/update/delete with shared state, confirmation, toasts, data refresh and batch support.
 * Rules live in `app/utils/mutation.ts`; this wires them to Nuxt (state, toasts, confirm, invalidate).
 *
 * State is shared by `id`: every component using the same id sees the same in-flight items,
 * so a list row shows "saving" even after the modal that started the save was closed.
 * Calls are never cancelled on unmount.
 *
 * Returned object is reactive: use `remove.isPending(id)`, don't destructure.
 *
 * @example
 * const remove = useMutation(
 *   (c: CategoryResponse) => unwrap(deleteCategory1({ path: { id: c.id! } })),
 *   { id: 'categories:remove', key: c => c.id!, confirm: c => ({ title: `Delete "${c.categoryName}"?`, danger: true }), ... },
 * )
 * await remove.execute(category)            // → { ok, status, data | error }
 * await remove.executeMany(selectedRows)    // → { succeeded, failed, skipped, notStarted, cancelled }
 */
export function useMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  options: MutationOptions<TInput, TResult> & {
    /** Unique `<feature>:<action>`, e.g. `categories:remove`. Components sharing it share state. */
    id: string
  },
) {
  const nuxtApp = useNuxtApp()
  const state = useState(`mutation:${options.id}`, () => createMutationState<TInput, TResult>())
  const pendingCount = usePendingMutationCount()
  const toast = useToast()
  const needsConfirm = Boolean(options.confirm || options.batch?.confirm)
  const confirm = needsConfirm ? useConfirm() : async () => true

  const mutation = createMutation(fn, options, {
    state: state.value,
    confirm,
    success: (title, description) =>
      toast.add({ title, description, color: 'success', icon: 'i-lucide-circle-check' }),
    failure: (title, description, actions) =>
      toast.add({
        title,
        description,
        color: 'error',
        icon: 'i-lucide-circle-alert',
        actions: actions?.map(a => ({ label: a.label, onClick: a.onClick, color: 'neutral', variant: 'outline' })),
        // Keep actionable failures on screen until the user reacts.
        duration: actions?.length ? 10_000 : undefined,
      }),
    progress: (title, onStop) => {
      const { id } = toast.add({
        title,
        icon: 'i-lucide-loader-circle',
        color: 'neutral',
        duration: Number.POSITIVE_INFINITY,
        progress: false,
        close: false,
        actions: [{ label: 'Stop', color: 'neutral', variant: 'outline', onClick: (e) => {
          e?.preventDefault() // keep the toast until the in-flight requests finish
          onStop()
          toast.update(id, { title: 'Stopping… waiting for requests in flight', actions: [] })
        } }],
        ui: { icon: 'animate-spin' },
      })
      return {
        update: next => toast.update(id, { title: next }),
        close: () => toast.remove(id),
      }
    },
    // Called after awaits: re-enter the Nuxt context explicitly.
    invalidate: features => nuxtApp.runWithContext(() => invalidate(...features)),
    onPendingChange: (delta) => {
      pendingCount.value += delta
    },
  })

  return reactive({
    ...mutation,
    /** Whether any call of this mutation is in flight. */
    pending: computed(() => mutation.isPending()),
    /** Last error (any item). */
    error: computed(() => state.value.lastError),
    /** Last successful result. */
    data: computed(() => state.value.lastResult),
  })
}
