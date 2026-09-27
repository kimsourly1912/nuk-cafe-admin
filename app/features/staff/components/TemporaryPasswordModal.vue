<script setup lang="ts">
/**
 * Shows a new staff account's temporary password, once: it isn't stored anywhere it can be read
 * again. The person must change it at their first sign-in.
 */
import { useClipboard } from '@vueuse/core'

const props = defineProps<{
  name: string
  email: string
  password: string
}>()
const emit = defineEmits<{ close: [] }>()

const { copy, copied, isSupported } = useClipboard({ source: () => props.password, copiedDuring: 2000 })
</script>

<template>
  <UModal
    title="Temporary password"
    :dismissible="false"
    :close="false"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm">
          Give this password to <span class="font-medium">{{ name }}</span> ({{ email }}). They choose their own at their first sign-in.
        </p>
        <div class="flex items-center gap-2">
          <code
            class="flex-1 rounded-md bg-elevated px-3 py-2 text-center font-mono text-lg tracking-wider"
            data-testid="temporary-password"
          >{{ password }}</code>
          <UButton
            v-if="isSupported"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :label="copied ? 'Copied' : 'Copy'"
            color="neutral"
            variant="outline"
            @click="copy()"
          />
        </div>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="It won't be shown again"
          description="Hand it over in person or through a private channel."
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end">
        <UButton
          label="Done"
          @click="emit('close')"
        />
      </div>
    </template>
  </UModal>
</template>
