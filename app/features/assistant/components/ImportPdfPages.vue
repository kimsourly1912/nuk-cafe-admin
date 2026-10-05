<script setup lang="ts">
import type { AssistantImportSource } from '#shared/contracts/assistant-import'
import { useAssistantPdf } from '../composables/useAssistantPdf'

const props = defineProps<{ source: AssistantImportSource }>()
const pdf = useAssistantPdf(props.source)
const canvasHost = ref<HTMLElement>()
watch(pdf.preview, async (canvas) => {
  await nextTick()
  canvasHost.value?.replaceChildren(...(canvas ? [canvas] : []))
  if (canvas) {
    canvas.className = 'max-w-full h-auto'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', `PDF source page ${pdf.page.value}`)
  }
})
watch(pdf.query.data, (data) => {
  if (data) void pdf.show(pdf.page.value)
})
</script>

<template>
  <section class="space-y-4">
    <h2 class="font-semibold text-highlighted">
      PDF source pages
    </h2>
    <p class="text-sm text-muted">
      Preview a PDF with up to five pages. Page selection is kept in this address; extraction is coming next.
    </p>
    <UButton
      :label="pdf.query.data.value || pdf.query.error.value ? 'Reload PDF pages' : 'Preview PDF pages'"
      color="neutral"
      variant="outline"
      :loading="pdf.query.pending.value"
      :disabled="pdf.previewBusy.value"
      @click="pdf.query.execute()"
    />
    <ListSkeleton
      v-if="pdf.query.loading.value"
      label="Loading PDF pages"
    />
    <ApiErrorAlert
      v-else-if="pdf.query.error.value"
      :error="pdf.query.error.value"
      @retry="pdf.query.execute()"
    />
    <div
      v-else-if="pdf.query.data.value"
      class="grid min-w-0 gap-4 sm:grid-cols-2"
    >
      <div class="space-y-4">
        <p
          role="status"
          class="text-sm text-muted"
        >
          {{ pdf.selected.value.length }} of {{ pdf.pages.value.length }} pages selected
        </p>
        <p
          v-if="!pdf.selected.value.length"
          class="text-sm text-warning"
        >
          Choose at least one page. Invalid page numbers in the address are not selected.
        </p>
        <ul class="divide-y divide-default">
          <li
            v-for="number in pdf.pages.value"
            :key="number"
            class="flex items-center justify-between gap-3 py-3"
          >
            <UCheckbox
              :label="`Select page ${number}`"
              :model-value="pdf.selected.value.includes(number)"
              @update:model-value="pdf.select(number, Boolean($event))"
            />
            <UButton
              :label="`View page ${number}`"
              color="neutral"
              variant="ghost"
              :aria-pressed="pdf.page.value === number"
              :disabled="pdf.previewBusy.value"
              @click="pdf.show(number)"
            />
          </li>
        </ul>
      </div>
      <div class="min-w-0 space-y-3">
        <h3 class="text-sm font-medium text-highlighted">
          Source page {{ pdf.page.value }}
        </h3>
        <p
          v-if="pdf.previewBusy.value"
          role="status"
          class="text-sm text-muted"
        >
          Preparing page preview…
        </p>
        <UAlert
          v-if="pdf.previewError.value"
          :title="pdf.previewError.value"
          color="warning"
        />
        <div ref="canvasHost" />
        <p class="text-xs text-muted">
          Preview only. Compare with the original PDF before using extracted items.
        </p>
      </div>
    </div>
  </section>
</template>
