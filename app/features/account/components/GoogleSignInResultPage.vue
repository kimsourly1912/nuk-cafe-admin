<script setup lang="ts">
import { ACCOUNT_PATHS } from '../utils/account'
import { googlePopupChannel } from '../utils/google-sign-in'

const route = useRoute()
let channel: BroadcastChannel | undefined
onScopeDispose(() => channel?.close())
onMounted(() => {
  const attempt = route.query.googlePopup
  if (typeof attempt !== 'string' || !/^[\da-f-]{36}$/i.test(attempt)) return
  channel = new BroadcastChannel(googlePopupChannel(attempt))
  channel.onmessage = (event: MessageEvent) => {
    if (event.origin === window.location.origin && event.data?.type === 'google-received' && event.data?.attempt === attempt) window.close()
  }
  const error = route.query.error === 'account_not_linked' || route.query.error === 'google_password_required' ? route.query.error : undefined
  channel.postMessage({ type: 'google-complete', path: ACCOUNT_PATHS.googleCallback, attempt, success: route.query.google === '1' && !route.query.error, error })
})
</script>

<template>
  <UAlert
    title="Returning to your sign-in window"
    description="You can close this popup and return to the original window if it does not close automatically."
    color="neutral"
    variant="subtle"
    icon="i-lucide-log-in"
  />
</template>
