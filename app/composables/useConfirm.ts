import { ConfirmDialog } from '#components'
import type { ConfirmOptions } from '~/utils/mutation'

/**
 * Promise-based confirmation dialog. It closes as soon as the user answers;
 * the confirmed work continues in the background (see useMutation).
 *
 * @example
 * const confirm = useConfirm()
 * if (!await confirm({ title: 'Delete category?', danger: true, confirmLabel: 'Delete' })) return
 */
export function useConfirm() {
  const overlay = useOverlay()

  return async (options: ConfirmOptions): Promise<boolean> => {
    // One overlay per question, removed when it closes, so callers outside components
    // (route middleware) don't pile up overlay entries.
    const confirmed = await overlay.create(ConfirmDialog, { destroyOnClose: true }).open(options).result
    return confirmed === true
  }
}
