import { ofetch } from 'ofetch'
import { HumanCheckModal } from '#components'
import { HUMAN_CHECK_HEADER, humanCheckAction } from '#shared/utils/human-check'

/** Existing auth transport, with a fresh on-demand browser token for sensitive actions (D217). */
export function useAuthRequest() {
  const config = useRuntimeConfig().public.humanCheck
  const overlay = useOverlay()
  const router = useRouter()

  return async <T>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
    const action = humanCheckAction(path)
    let headers: Record<string, string> | undefined
    if (config.enabled && action) {
      if (!import.meta.client || !config.siteKey) {
        throw new ApiError('Browser verification is unavailable. Try again shortly.', { kind: 'business', status: 0 })
      }
      const before = router.currentRoute.value.fullPath
      const token = await overlay.create(HumanCheckModal, { destroyOnClose: true }).open({ action }).result
      if (!token || router.currentRoute.value.fullPath !== before) {
        throw new ApiError('Browser check cancelled. Try again when you are ready.', { kind: 'business', status: 0 })
      }
      headers = { [HUMAN_CHECK_HEADER]: token }
    }
    // Never retry an auth write with a single-use token. A new submit creates a new widget/token.
    return await ofetch<T>(`/api/auth${path}`, { method: 'POST', body, headers, retry: 0, timeout: 30_000 })
  }
}
