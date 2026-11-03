import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAuthCompletion } from '../../app/composables/useAuthCompletion'

describe('auth completion after leaving a flow', () => {
  it.each([false, true])('a deferred response advances only while its scope is open (left: %s)', async (left) => {
    const scope = effectScope()
    const assertActive = scope.run(useAuthCompletion)!
    let answer!: () => void
    const response = new Promise<void>(resolve => (answer = resolve))
    const advance = vi.fn()
    const completion = (async () => {
      await response
      assertActive()
      advance()
    })()
    if (left) scope.stop()
    answer()
    if (left) {
      await expect(completion).rejects.toMatchObject({ kind: 'aborted' })
      expect(advance).not.toHaveBeenCalled()
    }
    else {
      await completion
      expect(advance).toHaveBeenCalledOnce()
      scope.stop()
    }
  })
})
