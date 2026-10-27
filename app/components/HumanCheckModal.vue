<script setup lang="ts">
import type { HumanCheckAction } from '#shared/utils/human-check'
import { loadTurnstile } from '~/utils/turnstile'
import type { TurnstileApi } from '~/utils/turnstile'

const props = defineProps<{ action: HumanCheckAction }>()
const emit = defineEmits<{ close: [token: string | null] }>()
const config = useRuntimeConfig().public.humanCheck
const colorMode = useColorMode()
const container = useTemplateRef<HTMLElement>('container')
const failed = ref(false)
let api: TurnstileApi | undefined
let widget: string | undefined
let attempt = 0

function removeWidget() {
  if (api && widget !== undefined) api.remove(widget)
  widget = undefined
}

async function start() {
  const current = ++attempt
  failed.value = false
  removeWidget()
  try {
    api = await loadTurnstile()
    if (current !== attempt || !container.value) return
    const fail = () => {
      if (current === attempt) failed.value = true
      return true
    }
    widget = api.render(container.value, {
      'sitekey': config.siteKey,
      'action': props.action,
      'theme': colorMode.value === 'dark' ? 'dark' : 'light',
      'size': 'flexible',
      'retry': 'never',
      'refresh-expired': 'never',
      'refresh-timeout': 'never',
      'callback': (token) => {
        if (current === attempt && token && token.length <= 2048) emit('close', token)
      },
      'error-callback': fail,
      'expired-callback': fail,
      'timeout-callback': fail,
    })
  }
  catch {
    if (current === attempt) failed.value = true
  }
}

// The modal's portal body can mount after the component itself.
watch(container, (element) => {
  if (element) void start()
})
onBeforeUnmount(() => {
  attempt++
  removeWidget()
})
</script>

<template>
  <AppModal
    title="Browser check"
    description="Complete this check to continue."
    :close="false"
    :dismissible="false"
    :ui="{ content: 'sm:max-w-sm' }"
    @back="emit('close', null)"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="failed"
          title="Couldn't complete the browser check"
          description="Check your connection and try again."
          color="error"
          variant="subtle"
          role="alert"
        />
        <p
          v-else
          role="status"
          class="text-sm text-muted"
        >
          Checking your browser…
        </p>
        <div
          ref="container"
          class="min-w-0"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="emit('close', null)"
        />
        <UButton
          v-if="failed"
          label="Try again"
          @click="start()"
        />
      </div>
    </template>
  </AppModal>
</template>
