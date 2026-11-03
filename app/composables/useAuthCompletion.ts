import { onScopeDispose } from 'vue'
import { ApiError } from '~/utils/api-error'

/** Auth writes may finish after their page leaves; only a mounted flow may advance its UI. */
export function useAuthCompletion() {
  let active = true
  onScopeDispose(() => {
    active = false
  })
  return () => {
    if (!active) throw new ApiError('This page is no longer open.', { kind: 'aborted', status: 0 })
  }
}
