import { ConfirmDialog } from '#components'

/**
 * Promise-based confirmation dialog.
 *
 * @example
 * const confirm = useConfirm()
 * if (!await confirm({ title: 'Delete category?', danger: true, confirmLabel: 'Delete' })) return
 */
export function useConfirm() {
  const overlay = useOverlay()
  const modal = overlay.create(ConfirmDialog)

  return async (props: InstanceType<typeof ConfirmDialog>['$props']): Promise<boolean> => {
    const confirmed = await modal.open(props).result
    return confirmed === true
  }
}
