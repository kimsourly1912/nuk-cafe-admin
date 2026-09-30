<script setup lang="ts">
/** View a delivery's saved message (D113): exactly what was, or will be, sent, as text. */
import { fetchSnapshot } from '../composables/useTelegram'

const props = defineProps<{ id: string, subject: string }>()
const emit = defineEmits<{ close: [] }>()

const { isCompact } = useLayoutContext()
const snapshot = useApiQuery(() => `telegram:snapshot:${props.id}`, () => fetchSnapshot(props.id))
</script>

<template>
  <UModal
    :title="subject"
    description="The message as it was saved when it was queued."
    :fullscreen="isCompact"
    @update:open="(open: boolean) => { if (!open) emit('close') }"
  >
    <template #body>
      <ApiErrorAlert
        v-if="snapshot.error.value"
        :error="snapshot.error.value"
        title="Could not load the message"
        @retry="snapshot.refresh()"
      />
      <USkeleton
        v-else-if="!snapshot.data.value"
        class="h-40"
      />
      <template v-else>
        <pre
          v-if="snapshot.data.value.text"
          class="max-h-96 overflow-y-auto rounded-md bg-elevated/50 p-3 font-sans text-sm whitespace-pre-wrap text-default"
        >{{ snapshot.data.value.text }}</pre>
        <p
          v-if="snapshot.data.value.attachment"
          class="mt-3 flex items-center gap-2 text-sm text-muted"
        >
          <UIcon
            name="i-lucide-file-spreadsheet"
            class="size-4"
          />
          {{ snapshot.data.value.attachment }}
        </p>
      </template>
    </template>
  </UModal>
</template>
