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
  const modal = overlay.create(ConfirmDialog)

  return async (options: ConfirmOptions): Promise<boolean> => {
    const confirmed = await modal.open(options).result
    return confirmed === true
  }
}
