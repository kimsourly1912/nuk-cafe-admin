<script setup lang="ts">
import type { AssistantImportReview, AssistantImportSource } from '#shared/contracts/assistant-import'
import { ASSISTANT_PDF_MAX_PAGE_ATTEMPTS } from '#shared/contracts/assistant-import'
import type { useAssistantImport } from '../composables/useAssistantImport'
import { useAssistantPdf } from '../composables/useAssistantPdf'
import { pdfUnfinishedPages } from '../utils/pdf'

const props = defineProps<{ source: AssistantImportSource, review?: AssistantImportReview, flow?: ReturnType<typeof useAssistantImport> }>()
const pdf = useAssistantPdf(props.source, () => props.review?.pdf)
const fixed = computed(() => Boolean(props.review?.pdf))
const completed = computed(() => props.review?.pdf?.pages.filter(p => p.state === 'ready').length ?? 0)
const running = computed(() => props.flow?.pdfRunning.value || props.flow?.pdfExtract.pending || props.review?.state === 'processing')
const busy = computed(() => props.flow?.busy.value === true)
const processingEnabled = computed(() => props.flow?.status.data.value?.pdfProcessing === true)
const unfinished = computed(() => props.review ? pdfUnfinishedPages(props.review) : [])
const canExtract = computed(() => processingEnabled.value && !busy.value && !props.flow?.leaseBusy.value && !props.flow?.expired.value && !pdf.previewBusy.value && Boolean(pdf.query.data.value) && !pdf.query.error.value && (fixed.value ? unfinished.value.length > 0 : pdf.selected.value.length > 0))
const canFinish = computed(() => processingEnabled.value && !busy.value && props.review?.state !== 'ready' && props.review?.state !== 'processing' && completed.value > 0 && Boolean(props.review?.rows.length))
const canvasHost = ref<HTMLElement>()
const pageState = (number: number) => props.review?.pdf?.pages.find(p => p.pageNumber === number)
const pageError = (number: number) => props.flow?.pdfExtract.errorOf(`${props.source.id}:${number}`)
const visiblePageError = (number: number) => {
  const error = pageError(number)
  return error && !isSilentError(error)
}
const statusLabel = (number: number) => {
  const state = pageState(number)
  if (state?.state === 'ready') return `${state.itemCount} ${state.itemCount === 1 ? 'item' : 'items'} extracted`
  if (state?.state === 'skipped') return 'Skipped'
  if (state?.state === 'processing') return 'Extracting…'
  if (state && state.attempts >= ASSISTANT_PDF_MAX_PAGE_ATTEMPTS) return 'Attempt limit reached'
  if (state?.error === 'AI_LIMIT_REACHED') return 'Daily limit reached. Try again tomorrow.'
  if (state?.error === 'AI_CAPACITY_REACHED') return 'Assistant busy. Try again later.'
  if (state?.state === 'failed') return 'Not extracted. Retry when available.'
  return pageError(number)?.message ?? (state ? 'Not extracted yet' : '')
}
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
  if (data && !running.value) void pdf.show(pdf.page.value)
})
async function extract() {
  if (!canExtract.value) return
  await props.flow?.extractPdf(pdf.selected.value, pdf.pageBlob)
}
</script>

<template>
  <section class="space-y-4">
    <h2 class="font-semibold text-highlighted">
      PDF source pages
    </h2>
    <p class="text-sm text-muted">
      <template v-if="processingEnabled">
        Choose pages, extract their menu items, then check them against the original PDF. Page selection is fixed once extraction starts.
      </template>
      <template v-else-if="fixed">
        Compare each item with its source page and the original PDF before creating drafts.
      </template>
      <template v-else>
        Preview a PDF with up to five pages. Page selection is kept in this address; extraction is coming next.
      </template>
    </p>
    <div
      v-if="fixed"
      class="space-y-3"
    >
      <p
        role="status"
        class="text-sm text-muted"
      >
        {{ completed }} of {{ review?.pdf?.pages.length }} selected pages extracted. Page selection is saved for this import.
      </p>
      <UProgress
        :model-value="completed"
        :max="review?.pdf?.pages.length"
        aria-label="PDF extraction progress"
      />
      <ul class="divide-y divide-default">
        <li
          v-for="entry in review?.pdf?.pages"
          :key="entry.pageNumber"
          class="space-y-1 py-3"
        >
          <p class="text-sm font-medium text-highlighted">
            Page {{ entry.pageNumber }}
          </p>
          <p class="break-words text-sm text-muted">
            {{ statusLabel(entry.pageNumber) }}
          </p>
          <p
            v-if="visiblePageError(entry.pageNumber)"
            role="alert"
            class="break-words text-sm text-error"
          >
            {{ pageError(entry.pageNumber)?.message }}
          </p>
        </li>
      </ul>
    </div>
    <UAlert
      v-if="flow?.pdfPrepare.errorOf(source.id)"
      :title="flow.pdfPrepare.errorOf(source.id)?.message"
      color="error"
    />
    <UAlert
      v-if="flow?.pdfFinish.errorOf(source.id)"
      :title="flow.pdfFinish.errorOf(source.id)?.message"
      color="error"
    />
    <p
      v-if="flow?.leaseBusy.value && !running"
      role="status"
      class="text-sm text-muted"
    >
      Waiting for the previous extraction to finish. Retry will become available shortly.
    </p>
    <div
      v-if="running"
      class="space-y-3"
    >
      <p
        role="status"
        class="text-sm text-muted"
      >
        Extracting pages one at a time. Completed results are saved. Work already started may count toward today's usage.
      </p>
      <UButton
        label="Stop extraction"
        color="neutral"
        variant="outline"
        :loading="flow?.cancel.pending"
        @click="flow?.cancel.execute({ sourceId: source.id })"
      />
    </div>
    <UButton
      :label="pdf.query.data.value || pdf.query.error.value ? 'Reload PDF pages' : 'Preview PDF pages'"
      color="neutral"
      variant="outline"
      :loading="pdf.query.pending.value"
      :disabled="busy || running || pdf.previewBusy.value"
      @click="pdf.query.execute()"
    />
    <ListSkeleton
      v-if="pdf.query.loading.value"
      label="Loading PDF pages"
    />
    <ApiErrorAlert
      v-else-if="pdf.query.error.value"
      :error="pdf.query.error.value"
      @retry="!busy && !running && !pdf.previewBusy.value && pdf.query.execute()"
    />
    <div
      v-else-if="pdf.query.data.value"
      class="grid min-w-0 gap-4"
      :class="{ 'sm:grid-cols-2': review?.state !== 'ready' }"
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
              :disabled="fixed || busy"
              @update:model-value="pdf.select(number, Boolean($event))"
            />
            <UButton
              :label="`View page ${number}`"
              color="neutral"
              variant="ghost"
              :aria-pressed="pdf.page.value === number"
              :disabled="busy || running || pdf.previewBusy.value"
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
          Compare with the original PDF before using extracted items.
        </p>
      </div>
    </div>
    <section
      v-if="review?.rows.length && review.state !== 'ready'"
      class="space-y-3"
    >
      <h3 class="text-sm font-medium text-highlighted">
        Items from successful pages
      </h3>
      <p class="text-sm text-muted">
        These results are saved. Finish the remaining pages or choose Review successful pages before correcting items or creating drafts.
      </p>
      <ul class="divide-y divide-default">
        <li
          v-for="row in review.rows"
          :key="row.id"
          class="space-y-1 py-3"
        >
          <p class="break-words text-sm font-medium text-highlighted">
            {{ row.source.name }}
          </p>
          <p class="text-xs text-muted">
            Source page {{ row.sourcePageNumber }}
          </p>
          <p
            v-for="(price, index) in row.source.prices"
            :key="index"
            class="break-words text-xs text-muted"
          >
            {{ price.label ?? 'Price' }}: {{ price.evidence ?? 'Unreadable' }} · {{ price.currency }}
          </p>
        </li>
      </ul>
    </section>
    <BottomActionBar
      v-if="processingEnabled && !running && review?.state !== 'ready'"
      label="Extract PDF pages"
      expanded="pinned"
    >
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <UButton
          :label="fixed ? 'Retry unfinished pages' : 'Extract menu'"
          icon="i-lucide-sparkles"
          :disabled="!canExtract"
          @click="extract"
        />
        <UButton
          v-if="completed > 0"
          label="Review successful pages"
          color="neutral"
          variant="outline"
          :disabled="!canFinish"
          :loading="flow?.pdfFinish.pending"
          @click="flow?.pdfFinish.execute({ sourceId: source.id })"
        />
      </div>
    </BottomActionBar>
  </section>
</template>
