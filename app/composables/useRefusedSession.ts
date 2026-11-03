import { useDocumentVisibility } from '@vueuse/core'
import type { RefusedSession, WorkspaceDoor } from '~/utils/account-cafes'

/**
 * A workspace's sign-in page, arrived at already signed in by an account the workspace refuses (a
 * manager or a platform account sent to the admin's sign-in, D239; a cafe owner sent to the console's,
 * D241): `refused` names it and where it
 * may go, and the page shows `<WorkspaceRefused>` instead of the form. Read once in the browser;
 * until `checked`, the page shows its skeleton (D238). The page also sets `refused` after a refused
 * sign-in, and clears it after Use another account.
 *
 * Another tab may sign in or out while the panel shows (any workspace or the customer site, E3): it's
 * read again when this tab comes back into view. Still refused: the panel follows (another account,
 * or what it may open now). No longer (signed out, or now an account that opens here): the form; an
 * admin signed in elsewhere is sent on by `plugins/auth-sync.client.ts`.
 */
export function useRefusedSession(workspace: WorkspaceDoor) {
  // The console has no cafe (D241).
  const slug = useOptionalTenantSlug()
  const refused = ref<RefusedSession | null>(null)
  const checked = ref(false)
  const error = shallowRef<ApiError>()
  const surface = workspace === 'console' ? 'platform' : workspace
  const session = useWorkspaceSession<{ userId: string }>(surface, `/${surface}/me`)
  const identity = useSessionIdentity()
  const admitted = computed(() => !!session.user.value)
  let read = 0
  async function refresh() {
    const current = ++read
    const startedIn = identity.generation.value
    try {
      if (!session.checked.value || session.error.value) await session.fetchSession()
      if (session.error.value) throw session.error.value
      const next = session.user.value ? null : await refusedSession(slug.value ?? '', workspace)
      if (read !== current || startedIn !== identity.generation.value) return
      refused.value = next
      error.value = undefined
      checked.value = true
    }
    catch (cause) {
      if (read !== current || startedIn !== identity.generation.value) return
      const failure = ApiError.from(cause)
      if (failure.kind !== 'aborted') error.value = failure
    }
  }
  onMounted(() => {
    if (session.error.value) error.value = session.error.value
    else void refresh()
  })
  onScopeDispose(() => {
    read++
  })

  const visibility = useDocumentVisibility()
  watch(visibility, async (state) => {
    if (state !== 'visible' || !refused.value) return
    await refresh()
  })

  return { refused, checked, error, refresh, admitted }
}
