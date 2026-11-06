<script setup lang="ts">
import { ACCOUNT_PATHS } from '../utils/account'
import { googleCallbackFallback, googlePopupChannel, googleSignInErrorCode } from '~/utils/google-sign-in'

/** The originating form shows every outcome, so this window reports it and closes unseen. */
const ACK_WAIT_MS = 500
const CLOSE_WAIT_MS = 300

const route = useRoute()
let channel: BroadcastChannel | undefined
let ackWait: ReturnType<typeof setTimeout> | undefined
let closeWait: ReturnType<typeof setTimeout> | undefined
onScopeDispose(() => {
  channel?.close()
  clearTimeout(ackWait)
  clearTimeout(closeWait)
})

function leave() {
  if (closeWait) return
  clearTimeout(ackWait)
  window.close()
  // A browser may refuse, such as for a window this site didn't open: continue on the sign-in page.
  closeWait = setTimeout(() => navigateTo({ path: ACCOUNT_PATHS.signIn, query: googleCallbackFallback(route.query) }, { replace: true }), CLOSE_WAIT_MS)
}

onMounted(() => {
  const attempt = route.query.googlePopup
  // Better Auth's default error address carries no attempt: nothing to report, the form sees the close.
  if (typeof attempt !== 'string' || !/^[\da-f-]{36}$/i.test(attempt)) return leave()
  channel = new BroadcastChannel(googlePopupChannel(attempt))
  channel.onmessage = (event: MessageEvent) => {
    if (event.origin === window.location.origin && event.data?.type === 'google-received' && event.data?.attempt === attempt) leave()
  }
  const error = googleSignInErrorCode(route.query.error)
  channel.postMessage({ type: 'google-complete', path: ACCOUNT_PATHS.googleCallback, attempt, twoFactor: route.query.googleTwoFactor === '1', success: route.query.google === '1' && !route.query.error, error })
  // The form may be gone or frozen (a phone's background tab); its message still waits for it.
  ackWait = setTimeout(leave, ACK_WAIT_MS)
})
</script>

<template>
  <main>
    <p
      class="sr-only"
      role="status"
    >
      Finishing Google sign-in
    </p>
  </main>
</template>
