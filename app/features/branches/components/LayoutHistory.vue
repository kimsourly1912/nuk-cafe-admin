<script setup lang="ts">
import { fetchLayoutVersion, useLayoutHistory } from '../composables/useBranches'
import type { LayoutEditor } from '../composables/useLayoutEditor'

/**
 * The layout's version history (ISS-027, like Figma's): the versions kept as it autosaves, newest
 * first, with who saved them. Restore puts one in place of the editor's layout as one undo step;
 * autosave then saves it as a new version through the normal checks, so a restore can be undone.
 */
const props = defineProps<{ editor: LayoutEditor, branchId: string }>()
const open = defineModel<boolean>('open', { default: false })

const history = useLayoutHistory(props.branchId)
watch(open, (shown) => {
  if (shown) void (history.status.value === 'idle' ? history.execute() : history.refresh())
})

const toast = useToast()
const restoring = ref<number | null>(null)
async function restore(version: number) {
  restoring.value = version
  try {
    props.editor.restore(await fetchLayoutVersion(props.branchId, version))
    open.value = false
    toast.add({ title: `Version ${version} restored`, description: 'It saves as the newest version. Undo brings back what you had.', color: 'success', icon: 'i-lucide-history' })
  }
  catch {
    toast.add({ title: 'Could not restore this version', description: 'Try again.', color: 'error', icon: 'i-lucide-circle-alert' })
  }
  finally {
    restoring.value = null
  }
}
</script>

<template>
  <AppSlideover
    v-model:open="open"
    title="Version history"
    description="Kept as the layout saves itself, at most one every 10 minutes, the last 50."
  >
    <template #body>
      <ApiErrorAlert
        v-if="history.error.value && !history.data.value"
        :error="history.error.value"
        title="Could not load the history"
        @retry="history.refresh()"
      />
      <p
        v-else-if="history.data.value && !history.data.value.length"
        class="text-sm text-muted"
      >
        No versions yet: the first one is kept when the layout first saves.
      </p>
      <ul
        v-else
        class="flex flex-col divide-y divide-default"
        data-testid="layout-history"
      >
        <li
          v-for="entry in history.data.value ?? []"
          :key="entry.version"
          class="flex items-center gap-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-highlighted">
              Version {{ entry.version }}<span
                v-if="entry.version === editor.version.value"
                class="text-muted"
              > · current</span>
            </p>
            <p class="text-xs text-muted">
              {{ formatDateTime(entry.savedAt) }}<template v-if="entry.savedByName">
                · {{ entry.savedByName }}
              </template>
            </p>
          </div>
          <UButton
            label="Restore"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="restoring === entry.version"
            :disabled="entry.version === editor.version.value || restoring !== null"
            :aria-label="`Restore version ${entry.version}`"
            @click="restore(entry.version)"
          />
        </li>
      </ul>
    </template>
  </AppSlideover>
</template>
