import { useDocumentVisibility } from '@vueuse/core'
import type { Workspace } from '#shared/contracts/account'
import type { RefusedSession } from '~/utils/account-cafes'

/**
 * A workspace's sign-in page, arrived at already signed in by an account the workspace refuses (a
 * manager or a platform account sent to the admin's sign-in, D239): `refused` names it and where it
 * may go, and the page shows `<WorkspaceRefused>` instead of the form. Read once in the browser;
 * until `checked`, the page shows its skeleton (D238). The page also sets `refused` after a refused
 * sign-in, and clears it after Use another account.
 *
 * Another tab may sign in or out while the panel shows (any workspace or the customer site, E3): it's
 * read again when this tab comes back into view. Still refused: the panel follows (another account,
 * or what it may open now). No longer (signed out, or now an account that opens here): the form; an
 * admin signed in elsewhere is sent on by `plugins/auth-sync.client.ts`.
 */
export function useRefusedSession(workspace: Workspace) {
  const slug = useTenantSlug()
  const refused = ref<RefusedSession | null>(null)
  const checked = ref(false)
  onMounted(async () => {
    refused.value = await refusedSession(slug.value, workspace)
    checked.value = true
  })

  const visibility = useDocumentVisibility()
  watch(visibility, async (state) => {
    if (state !== 'visible' || !refused.value) return
    refused.value = await refusedSession(slug.value, workspace)
  })

  return { refused, checked }
}
