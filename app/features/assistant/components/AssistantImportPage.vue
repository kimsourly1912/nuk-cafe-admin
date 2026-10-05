<script setup lang="ts">
import type { AssistantImportDraft, AssistantImportReviewRow } from '#shared/contracts/assistant-import'
import { useAssistantImport } from '../composables/useAssistantImport'
import { importDraftProblem, importFileProblem } from '../utils/import'
import ImportRowEditor from './ImportRowEditor.vue'
import ImportDraftSummary from './ImportDraftSummary.vue'

const flow = useAssistantImport()
const { status, sources, reviewQuery, review, sourceId, expired, leaseBusy, busy } = flow
const route = useRoute()
const tenantPath = useTenantPath()
const basePath = tenantPath('/admin/products/import')
const file = ref<File | null>(null)
const fileProblem = computed(() => file.value ? importFileProblem(file.value) : undefined)
const sourceOpen = ref(false)
const previewFailed = ref(false)
const editorKey = ref(0)
const rowId = computed(() => typeof route.query.row === 'string' ? route.query.row : '')
const editing = computed(() => review.value?.rows.find(r => r.id === rowId.value && !r.createdItemId))
const candidates = computed(() => review.value?.rows.filter(r => r.selected && !r.createdItemId) ?? [])
const incomplete = computed(() => candidates.value.filter(r => importDraftProblem(r.draft)))
const saved = computed(() => review.value?.rows.filter(r => r.createdItemId) ?? [])
const sourceUrl = computed(() => `/api${tenantPath(`/admin/assistant/imports/${encodeURIComponent(sourceId.value)}/source`)}`)
const isPdf = computed(() => review.value?.source.mimeType === 'application/pdf')
const canCreate = computed(() => review.value?.state === 'ready' && !busy.value && !expired.value && candidates.value.length > 0 && !incomplete.value.length)
const extractError = computed(() => flow.extract.error)
const confirm = useConfirm()
const keyOf = (row: AssistantImportReviewRow) => `${sourceId.value}:${row.id}`
const creationError = (row: AssistantImportReviewRow) => flow.create.errorOf(keyOf(row))
const flagLabel = (flag: string) => ({ 'missing-price': 'Missing price', 'ambiguous-currency': 'Check currency', 'ambiguous-association': 'Check price / size mapping', 'unreadable': 'Hard to read' }[flag] ?? flag)
const reviewFailure = computed(() => review.value?.error ? ({ AI_LIMIT_REACHED: 'Today’s assistant limit has been reached. Your source is saved; try again tomorrow.', AI_CAPACITY_REACHED: 'The assistant is busy. Your source is saved; try again later.', AI_IMPORT_CANCELLED: 'Extraction stopped. Your private source is still available.', AI_IMPORT_RESULT_INVALID: 'The menu could not be read reliably. Try a clearer image.', AI_IMPORT_EXTRACTION_FAILED: 'The menu could not be extracted. Try again or use a clearer image.', AI_IMPORT_INTERRUPTED: 'Extraction was interrupted. You can retry when the assistant is available.' }[review.value.error] ?? '') : '')
watch(sourceId, () => {
  previewFailed.value = false
  sourceOpen.value = false
  editorKey.value++
})

async function showSource(id: string) {
  if (busy.value) return
  await navigateTo({ path: basePath, query: { source: id } })
}
async function newSource() {
  if (busy.value) return
  await navigateTo(basePath)
}
async function upload() {
  if (!file.value || fileProblem.value || busy.value) return
  const result = await flow.upload.execute(file.value)
  if (result.ok) {
    file.value = null
    await showSource(result.data.id)
  }
}
async function extract() {
  if (!sourceId.value || busy.value || expired.value || isPdf.value || leaseBusy.value) return
  await flow.extract.execute({ sourceId: sourceId.value })
}
async function discard() {
  if (busy.value) return
  const result = await flow.discard.execute({ sourceId: sourceId.value })
  if (result.ok) await newSource()
}
async function edit(row: AssistantImportReviewRow) {
  if (busy.value || expired.value || row.createdItemId) return
  flow.update.reset(keyOf(row))
  await navigateTo({ path: basePath, query: { source: sourceId.value, row: row.id } })
}
async function closeEditor() {
  await navigateTo({ path: basePath, query: { source: sourceId.value } })
}
async function apply(draft: AssistantImportDraft, version: number) {
  if (!editing.value || expired.value || busy.value) return false
  const result = await flow.update.execute({ sourceId: sourceId.value, rowId: editing.value.id, version, draft })
  return result.ok
}
async function reloadEditor() {
  await reviewQuery.refresh()
  if (!reviewQuery.error.value) editorKey.value++
}
async function select(row: AssistantImportReviewRow, selected: boolean) {
  if (busy.value || expired.value || row.createdItemId || !review.value) return
  await flow.update.execute({ sourceId: sourceId.value, rowId: row.id, version: review.value.source.version, selected })
}
async function createDrafts() {
  if (!canCreate.value) return
  flow.batchBusy.value = true
  try {
    await flow.create.executeMany(candidates.value.map(r => ({ sourceId: sourceId.value, rowId: r.id })))
  }
  finally { flow.batchBusy.value = false }
}
async function retry(row: AssistantImportReviewRow) {
  if (busy.value || expired.value || row.createdItemId || !row.selected || importDraftProblem(row.draft)) return
  const duplicate = creationError(row)?.code === 'ITEM_NAME_EXISTS'
  if (duplicate && !await confirm({ title: 'Create another item with this name?', description: 'An item with this name already exists in this cafe. Create a separate unpublished draft?', confirmLabel: 'Create another draft' })) return
  await flow.create.execute({ sourceId: sourceId.value, rowId: row.id, confirmDuplicate: duplicate })
}
</script>

<template>
  <UDashboardPanel
    id="assistant-import"
    :class="{ 'page-narrow': !review || Boolean(editing) || review.state !== 'ready' }"
  >
    <template #header>
      <UDashboardNavbar :title="editing ? 'Correct menu item' : 'Import menu'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            v-if="editing"
            label="Back to review"
            color="neutral"
            variant="ghost"
            :disabled="busy"
            @click="closeEditor"
          />
          <UButton
            v-else
            label="Menu items"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="tenantPath('/admin/products')"
          />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <ListSkeleton
        v-if="status.loading.value"
        label="Loading import availability"
      />
      <ApiErrorAlert
        v-else-if="status.error.value"
        :error="status.error.value"
        @retry="status.refresh()"
      />
      <UAlert
        v-else-if="!flow.enabled.value"
        title="Menu import is not available yet"
        description="You can create menu items through Menu items."
        color="neutral"
      />
      <template v-else-if="!sourceId">
        <div class="space-y-6">
          <p class="text-sm text-muted">
            Upload an English menu image to extract items, review them, then create unpublished drafts.
          </p>
          <UCard>
            <template #header>
              <h2 class="font-semibold text-highlighted">
                Upload a menu
              </h2>
            </template>
            <div class="space-y-4">
              <UFileUpload
                v-model="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                label="Choose a menu image or PDF"
                description="JPEG, PNG, WebP or PDF · up to 5 MB"
                :disabled="busy"
                :preview="false"
                :file-image="false"
              />
              <UAlert
                v-if="fileProblem"
                color="error"
                :title="fileProblem"
              />
              <UAlert
                v-if="file?.type === 'application/pdf'"
                color="warning"
                title="PDF extraction is coming next"
                description="You can store a private PDF now. Choose an image to extract menu items."
              />
              <UAlert
                v-if="flow.upload.error"
                color="error"
                :title="flow.upload.error.message"
              />
              <p class="text-sm text-muted">
                Sources and reviews are private to you and expire 24 hours after upload. Discard deletes the private source and review.
              </p>
              <UButton
                label="Upload source"
                icon="i-lucide-file-up"
                :loading="flow.upload.pending"
                :disabled="!file || Boolean(fileProblem) || busy"
                @click="upload"
              />
            </div>
          </UCard>
          <section class="space-y-3">
            <h2 class="font-semibold text-highlighted">
              Resume an import
            </h2>
            <ListSkeleton
              v-if="sources.loading.value"
              label="Loading saved imports"
            />
            <ApiErrorAlert
              v-else-if="sources.error.value"
              :error="sources.error.value"
              @retry="sources.refresh()"
            />
            <p
              v-else-if="!sources.data.value?.length"
              class="text-sm text-muted"
            >
              No saved imports. Upload a source to begin.
            </p>
            <ul
              v-else
              class="divide-y divide-default"
            >
              <li
                v-for="source in sources.data.value"
                :key="source.id"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  block
                  class="justify-start text-left"
                  :disabled="busy"
                  @click="showSource(source.id)"
                >
                  <span class="min-w-0 space-y-1"><span class="block break-words font-medium">{{ source.fileName }}</span><span class="block text-xs text-muted">Expires {{ new Date(source.expiresAt).toLocaleString() }}</span></span>
                </UButton>
              </li>
            </ul>
          </section>
        </div>
      </template>
      <ListSkeleton
        v-else-if="reviewQuery.loading.value"
        label="Loading review"
      />
      <div
        v-else-if="reviewQuery.error.value"
        class="space-y-4"
      >
        <ApiErrorAlert
          :error="reviewQuery.error.value"
          @retry="reviewQuery.refresh()"
        />
        <p
          v-if="reviewQuery.error.value.status === 404"
          class="text-sm text-muted"
        >
          This import may have expired or been discarded. Any drafts already created stay in Menu items.
        </p>
        <UButton
          label="Upload another source"
          color="neutral"
          variant="outline"
          @click="newSource"
        />
      </div>
      <template v-else-if="review">
        <UAlert
          v-if="expired"
          title="This private import has expired"
          description="Upload a new source to continue. Drafts already created remain in Menu items."
          color="warning"
        />
        <ImportRowEditor
          v-if="editing && !expired"
          :key="`${editing.id}:${editorKey}`"
          :row="editing"
          :version="review.source.version"
          :disabled="busy"
          :error="flow.update.errorOf(keyOf(editing))"
          :apply="apply"
          :reload="reloadEditor"
          @close="closeEditor"
        />
        <div
          v-else
          class="space-y-6"
        >
          <div class="flex flex-wrap items-center gap-2">
            <p class="min-w-0 flex-1 break-words text-sm font-medium">
              {{ review.source.fileName }}
            </p>
            <UButton
              v-if="isPdf"
              label="Download source PDF"
              :href="sourceUrl"
              external
              color="neutral"
              variant="outline"
              :disabled="expired"
            />
            <UButton
              v-else
              label="View source"
              color="neutral"
              variant="outline"
              :disabled="expired"
              @click="sourceOpen = true"
            />
            <UButton
              label="Reload review"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :disabled="busy"
              :loading="reviewQuery.refreshing.value"
              @click="reviewQuery.refresh()"
            />
            <UButton
              label="Discard import"
              color="error"
              variant="ghost"
              :disabled="busy || expired"
              @click="discard"
            />
            <UButton
              label="Another source"
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="newSource"
            />
          </div>
          <p class="text-xs text-muted">
            Private to you · expires {{ new Date(review.source.expiresAt).toLocaleString() }}
          </p>
          <UAlert
            v-if="isPdf"
            title="PDF extraction is coming next"
            description="Your PDF is stored privately. Upload an image to extract menu items now."
            color="warning"
          />
          <template v-else-if="review.state !== 'ready'">
            <div class="space-y-4">
              <img
                v-if="!previewFailed && !expired"
                :src="sourceUrl"
                alt="Uploaded menu source"
                class="max-h-96 w-full object-contain"
                @error="previewFailed = true"
              >
              <p
                v-if="previewFailed"
                class="text-sm text-warning"
              >
                The image preview could not be loaded. Check the source or try a clearer image.
              </p>
              <UAlert
                v-if="reviewFailure"
                :title="reviewFailure"
                color="warning"
              />
              <UAlert
                v-if="extractError && !isSilentError(extractError)"
                :title="extractError.message"
                color="error"
              />
              <UAlert
                v-if="review.state === 'processing' || flow.extract.pending"
                title="Extracting menu…"
                description="Keep this source available. Stop prevents the result from being saved; work already started may still count toward today's usage."
                color="neutral"
              />
              <p
                v-if="leaseBusy && review.state !== 'processing'"
                class="text-sm text-muted"
              >
                Waiting for the previous extraction to finish. Retry will become available shortly.
              </p>
              <UButton
                v-if="review.state === 'processing' || flow.extract.pending"
                label="Stop extraction"
                color="neutral"
                variant="outline"
                :loading="flow.cancel.pending"
                @click="flow.cancel.execute({ sourceId })"
              />
              <UButton
                v-else
                :label="review.state === 'failed' ? 'Retry extraction' : 'Extract menu'"
                icon="i-lucide-sparkles"
                :disabled="busy || expired || leaseBusy"
                @click="extract"
              />
            </div>
          </template>
          <div
            v-else
            class="grid min-w-0 gap-6 lg:grid-cols-2"
          >
            <section class="hidden min-w-0 space-y-3 lg:block">
              <h2 class="font-semibold text-highlighted">
                Source menu
              </h2>
              <img
                v-if="!previewFailed && !expired"
                :src="sourceUrl"
                alt="Uploaded menu source"
                class="max-h-screen w-full object-contain"
                @error="previewFailed = true"
              >
              <p
                v-if="previewFailed"
                class="text-sm text-warning"
              >
                The source preview could not be loaded. Use View source to try again.
              </p>
            </section>
            <section class="min-w-0 space-y-4">
              <h2 class="font-semibold text-highlighted">
                Review items
              </h2>
              <p class="text-sm text-muted">
                Check names, categories and prices. Nothing is published automatically.
              </p>
              <UAlert
                v-if="!review.rows.length"
                title="No items to review"
                description="Try another source or create menu items manually."
                color="neutral"
              />
              <p
                v-if="saved.length"
                role="status"
                class="text-sm text-success"
              >
                {{ saved.length }} {{ saved.length === 1 ? 'draft created' : 'drafts created' }}. Open each draft to review and publish through Menu items.
              </p>
              <ul class="divide-y divide-default">
                <li
                  v-for="row in review.rows"
                  :key="row.id"
                  class="space-y-3 py-4"
                >
                  <div class="flex items-start gap-3">
                    <UCheckbox
                      :model-value="row.selected"
                      :disabled="busy || expired || Boolean(row.createdItemId)"
                      :aria-label="`Include ${row.draft.name || row.source.name}`"
                      @update:model-value="v => select(row, v === true)"
                    />
                    <div class="min-w-0 flex-1 space-y-2">
                      <UButton
                        v-if="!row.createdItemId"
                        :label="row.draft.name || row.source.name"
                        color="neutral"
                        variant="link"
                        class="break-words text-left"
                        :disabled="busy || expired"
                        @click="edit(row)"
                      />
                      <p
                        v-else
                        class="break-words font-medium text-highlighted"
                      >
                        {{ row.draft.name }}
                      </p>
                      <ImportDraftSummary :draft="row.draft" />
                      <p class="break-words text-xs text-muted">
                        Source: {{ row.source.name }}<template v-if="row.source.category">
                          · {{ row.source.category }}
                        </template>
                      </p>
                      <p
                        v-for="(price, i) in row.source.prices"
                        :key="i"
                        class="break-words text-xs text-muted"
                      >
                        {{ price.label ?? 'Price' }}: {{ price.evidence ?? 'Unreadable' }} · {{ price.currency }}
                      </p>
                      <p
                        v-if="!row.createdItemId && row.source.flags.length"
                        class="text-sm text-warning"
                      >
                        {{ row.source.flags.map(flagLabel).join(' · ') }}
                      </p>
                      <p
                        v-if="!row.createdItemId && importDraftProblem(row.draft)"
                        class="text-sm text-warning"
                      >
                        {{ importDraftProblem(row.draft) }}
                      </p>
                      <p
                        v-if="!row.createdItemId && creationError(row)"
                        role="alert"
                        class="text-sm text-error"
                      >
                        {{ creationError(row)?.message }}
                      </p>
                    </div>
                    <UBadge
                      v-if="row.createdItemId"
                      label="Draft created"
                      color="success"
                      variant="subtle"
                    />
                    <UBadge
                      v-else-if="!row.selected"
                      label="Excluded"
                      color="neutral"
                      variant="subtle"
                    />
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <UButton
                      v-if="row.createdItemId"
                      label="Open draft"
                      :to="tenantPath(`/admin/products/${row.createdItemId}`)"
                      color="neutral"
                      variant="outline"
                    />
                    <UButton
                      v-else
                      label="Correct item"
                      icon="i-lucide-pencil"
                      color="neutral"
                      variant="outline"
                      :disabled="busy || expired"
                      @click="edit(row)"
                    />
                    <UButton
                      v-if="!row.createdItemId && creationError(row)"
                      :label="creationError(row)?.code === 'ITEM_NAME_EXISTS' ? 'Confirm duplicate' : 'Retry this draft'"
                      color="neutral"
                      variant="outline"
                      :disabled="busy || expired || !row.selected || Boolean(importDraftProblem(row.draft))"
                      @click="retry(row)"
                    />
                  </div>
                </li>
              </ul>
              <p
                v-if="incomplete.length"
                class="text-sm text-warning"
              >
                {{ incomplete.length }} selected {{ incomplete.length === 1 ? 'item needs' : 'items need' }} correction. Fix or exclude before creating drafts.
              </p>
              <BottomActionBar
                label="Create menu drafts"
                expanded="pinned"
              >
                <p class="min-w-0 flex-1 text-sm text-muted">
                  {{ candidates.length }} selected · {{ saved.length }} created
                </p>
                <UButton
                  :label="`Create ${candidates.length} ${candidates.length === 1 ? 'draft' : 'drafts'}`"
                  icon="i-lucide-save"
                  :loading="flow.batchBusy.value"
                  :disabled="!canCreate"
                  @click="createDrafts"
                />
              </BottomActionBar>
            </section>
          </div>
        </div>
      </template>
      <UModal
        v-model:open="sourceOpen"
        title="Source menu"
        :description="review?.source.fileName"
      >
        <template #body>
          <img
            v-if="sourceOpen && !expired"
            :src="sourceUrl"
            alt="Uploaded menu source"
            class="w-full object-contain"
          >
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
