import type { Workspace } from '#shared/contracts/account'
import type { RefusedSession } from '~/utils/account-cafes'

/**
 * A workspace's sign-in page, arrived at already signed in by an account the workspace refuses (a
 * manager or a platform account sent to the admin's sign-in, D236): `refused` names it and where it
 * may go, and the page shows `<WorkspaceRefused>` instead of the form. Read once in the browser;
 * until `checked`, the page shows its skeleton (D235). The page also sets `refused` after a refused
 * sign-in, and clears it after Use another account.
 */
export function useRefusedSession(workspace: Workspace) {
  const slug = useTenantSlug()
  const refused = ref<RefusedSession | null>(null)
  const checked = ref(false)
  onMounted(async () => {
    refused.value = await refusedSession(slug.value, workspace)
    checked.value = true
  })
  return { refused, checked }
}
