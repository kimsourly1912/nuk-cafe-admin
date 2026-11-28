<script setup lang="ts">
/**
 * Send to Telegram (step 8.1c, D112, the owner's frames): a report as it's shown on the page, to
 * one connected chat. The preview is the message the server will send; a group shows who will see
 * it; Attach CSV adds the report's file. Retries and status checks reuse the request's key.
 */
import type { RadioGroupItem } from '@nuxt/ui'
import type { SendableReport } from '#shared/contracts/notifications'
import { REPORT_DELIVERY_IN_PROGRESS, REPORT_DELIVERY_UNCERTAIN } from '#shared/contracts/notifications'
import { useReportDestinations, useSendReport, useTelegramPreview } from '../composables/useReports'

const tenantPath = useTenantPath()

const props = defineProps<{
  kind: SendableReport
  /** "Summary · Today (30 Sep)". */
  title: string
  /** The page's query, as text. */
  query: Record<string, string>
}>()
const emit = defineEmits<{ close: [sent: boolean] }>()

const { isCompact } = useLayoutContext()
const destinations = useReportDestinations()
const report = computed(() => ({ kind: props.kind, query: props.query }))
const preview = useTelegramPreview(report)
const send = useSendReport()

const connected = computed(() => (destinations.data.value?.destinations ?? []))
const destinationId = ref<string>()
const attachCsv = ref(false)
watch(connected, (list) => {
  if (!destinationId.value) destinationId.value = list.find(d => d.status === 'connected')?.id
}, { immediate: true })

const chosen = computed(() => connected.value.find(d => d.id === destinationId.value))
const items = computed<RadioGroupItem[]>(() => connected.value.map(d => ({
  value: d.id,
  label: d.title,
  description: d.status === 'blocked'
    ? 'Blocked: reconnect it on the Telegram page'
    : d.kind === 'group' ? 'Group' : 'Private chat',
  disabled: d.status === 'blocked',
})))

// One key per different request: Send again after a failure reuses it; another chat or the CSV
// option is a new request with a new key.
const keys = new Map<string, string>()
const keyFor = (request: string) => keys.get(request) ?? keys.set(request, crypto.randomUUID()).get(request)!

const failure = ref<{ kind: 'failed' | 'checking' | 'uncertain', message: string }>()
const locked = computed(() => send.pending || (failure.value !== undefined && failure.value.kind !== 'failed'))
watch([destinationId, attachCsv], () => {
  if (failure.value?.kind === 'failed') failure.value = undefined
})

async function submit() {
  const id = destinationId.value
  if (!id || failure.value?.kind === 'uncertain' || (failure.value?.kind !== 'checking' && chosen.value?.status !== 'connected')) return
  failure.value = undefined
  const body = { report: report.value, destinationId: id, attachCsv: attachCsv.value }
  const result = await send.execute({ ...body, key: keyFor(JSON.stringify(body)) })
  if (result.ok) emit('close', true)
  else if (result.status === 'error') {
    const error = result.error
    if (error.code === REPORT_DELIVERY_UNCERTAIN) failure.value = { kind: 'uncertain', message: error.message }
    else if (error.code === REPORT_DELIVERY_IN_PROGRESS || error.retryable) {
      failure.value = {
        kind: 'checking',
        message: error.code === REPORT_DELIVERY_IN_PROGRESS ? error.message : 'The send status is unavailable. Check delivery to continue with the same report.',
      }
    }
    else failure.value = { kind: 'failed', message: error.message }
    // Telegram said the chat is gone: show it blocked.
    if (result.error.code === 'TELEGRAM_BLOCKED') destinations.refresh()
  }
}
</script>

<template>
  <AppModal
    :title="`Send ${title}`"
    description="To a Telegram chat connected on the Telegram page."
    :fullscreen="isCompact"
    :ui="{ body: 'space-y-5' }"
    @update:open="(open: boolean) => { if (!open) emit('close', false) }"
  >
    <template #body>
      <ApiErrorAlert
        v-if="destinations.error.value"
        :error="destinations.error.value"
        title="Could not load the chats"
        @retry="destinations.refresh()"
      />
      <USkeleton
        v-else-if="!destinations.data.value"
        class="h-20"
      />
      <UAlert
        v-else-if="!connected.length"
        color="neutral"
        variant="subtle"
        icon="i-lucide-send"
        title="No Telegram chat is connected yet."
        description="Connect your private chat or a group first."
        :actions="[{ label: 'Open Telegram settings', to: tenantPath('/admin/telegram'), color: 'neutral', variant: 'outline', onClick: () => emit('close', false) }]"
      />
      <template v-else>
        <URadioGroup
          v-model="destinationId"
          legend="Send to"
          :items="items"
          :disabled="locked"
        />
        <UAlert
          v-if="chosen?.kind === 'group'"
          color="warning"
          variant="subtle"
          icon="i-lucide-users"
          :title="`Everyone in ${chosen.title} will see these figures.`"
        />
        <UCheckbox
          v-model="attachCsv"
          label="Attach CSV"
          description="The report's file, with every matching row."
          :disabled="locked"
        />
      </template>

      <section aria-labelledby="telegram-preview">
        <h3
          id="telegram-preview"
          class="mb-2 text-sm font-medium text-highlighted"
        >
          Preview
        </h3>
        <ApiErrorAlert
          v-if="preview.error.value"
          :error="preview.error.value"
          title="Could not build the message"
          @retry="preview.refresh()"
        />
        <USkeleton
          v-else-if="!preview.data.value"
          class="h-40"
        />
        <pre
          v-else
          class="max-h-72 overflow-y-auto rounded-md bg-elevated/50 p-3 font-sans text-sm whitespace-pre-wrap text-default"
        >{{ preview.data.value.text }}</pre>
      </section>

      <UAlert
        v-if="failure"
        :color="failure.kind === 'failed' ? 'error' : 'warning'"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="failure.kind === 'failed' ? 'Delivery incomplete' : 'Delivery unconfirmed'"
        :description="failure.message"
      />
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          :label="failure?.kind === 'uncertain' ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="emit('close', false)"
        />
        <UButton
          v-if="failure?.kind !== 'uncertain'"
          :label="failure?.kind === 'checking' ? 'Check delivery' : failure ? 'Try again' : 'Send'"
          icon="i-lucide-send"
          :loading="send.pending"
          :disabled="failure?.kind !== 'checking' && chosen?.status !== 'connected'"
          @click="submit()"
        />
      </div>
    </template>
  </AppModal>
</template>
