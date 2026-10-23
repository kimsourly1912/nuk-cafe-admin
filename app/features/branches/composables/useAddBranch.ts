import { MAX_BRANCHES } from '#shared/contracts/branches'
import NewBranchModal from '../components/NewBranchModal.vue'
import { useBranchOptions } from './useBranchOptions'

/**
 * Add branch (D197), from the Branches list or a one-branch cafe's Branch page: the dialog, then
 * the new branch's Settings, where its hours are set. `full` at the cafe's limit (the server checks
 * it too).
 */
export function useAddBranch() {
  const tenantPath = useTenantPath()
  const modal = useOverlay().create(NewBranchModal)
  const { data: branches } = useBranchOptions()
  const full = computed(() => (branches.value?.length ?? 0) >= MAX_BRANCHES)

  async function addBranch(timezone?: string) {
    const added = await modal.open({ timezone }).result
    if (added) await navigateTo(tenantPath(`/admin/branches/${added.id}`))
  }

  return { addBranch, full, limit: MAX_BRANCHES }
}
