<script setup lang="ts">
import type { DiningTable } from '#shared/contracts/branches'
import type { LayoutEditor } from '../composables/useLayoutEditor'
import { ITEM_SPECS } from '../designer/catalog'

const props = defineProps<{
  editor: LayoutEditor
  diningTables: readonly DiningTable[]
}>()

const tableLabel = (id: string) => props.editor.tables.value.find(table => table.id === id)?.label ?? props.diningTables.find(table => table.id === id)?.label
const conflict = computed(() => props.editor.conflict.value)
const unavailableLabels = computed(() => props.editor.unavailable.value.map(placement => tableLabel(placement.tableId) ?? 'A deleted table'))
const unknownLookLabels = computed(() => props.editor.unknownLooks.value.map(placement => tableLabel(placement.tableId) ?? 'A table'))
const unknownItemLookLabels = computed(() => props.editor.unknownItemLooks.value.map(item => ITEM_SPECS[item.kind].label))

function listLabels(labels: readonly string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/** 6A: who saved the newer version and when, if the editor has read it. */
function conflictText(latest: { updatedAt: string | null, updatedByName: string | null } | null | undefined): string {
  const by = latest?.updatedByName ? ` by ${latest.updatedByName}` : ''
  const when = latest?.updatedAt ? ` ${formatTimeAgo(latest.updatedAt)}` : ''
  return `${by || when ? `Saved${by}${when}. ` : ''}Your draft is kept here until you choose.`
}
</script>

<template>
  <div
    v-if="conflict || editor.problem.value || unavailableLabels.length || unknownLookLabels.length || unknownItemLookLabels.length"
    class="grid max-h-[35dvh] shrink-0 gap-2 overflow-y-auto border-b border-default bg-default px-3 py-2"
  >
    <!-- Someone else saved (6A): the draft stays until the owner chooses. -->
    <UAlert
      v-if="conflict"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="This layout was changed somewhere else"
      :description="conflictText(conflict.latest)"
      :actions="[
        { label: 'Load latest', color: 'neutral', variant: 'outline', onClick: () => editor.loadLatest() },
        { label: 'Overwrite with mine', color: 'error', variant: 'outline', onClick: () => editor.overwrite() },
      ]"
      data-testid="layout-conflict"
    />
    <UAlert
      v-if="editor.problem.value"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Not saved"
      :description="editor.problem.value"
      close
      @update:open="editor.dismissProblem()"
    />
    <UAlert
      v-if="unavailableLabels.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="`${listLabels(unavailableLabels)} ${unavailableLabels.length === 1 ? 'is' : 'are'} no longer an active table here.`"
      description="Archived or deleted since this layout was opened. Remove it from the map to save."
      :actions="[{ label: 'Remove from map', color: 'neutral', variant: 'outline', onClick: () => editor.removeUnavailable() }]"
      data-testid="layout-unavailable"
    />
    <UAlert
      v-if="unknownLookLabels.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="`The look of ${listLabels(unknownLookLabels)} was deleted.`"
      description="Deleted since this layout was opened. Give it the standard look to save, then choose another."
      :actions="[{ label: 'Use Round café table', color: 'neutral', variant: 'outline', onClick: () => editor.resetUnknownLooks() }]"
      data-testid="layout-unknown-looks"
    />
    <UAlert
      v-if="unknownItemLookLabels.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="`The look of ${unknownItemLookLabels.length === 1 ? 'a piece' : `${unknownItemLookLabels.length} pieces`} (${listLabels([...new Set(unknownItemLookLabels)])}) was deleted.`"
      description="Deleted since this layout was opened. Give the pieces their own finishes to save, then choose another look."
      :actions="[{ label: 'Use own finishes', color: 'neutral', variant: 'outline', onClick: () => editor.resetUnknownLooks() }]"
      data-testid="layout-unknown-item-looks"
    />
  </div>
</template>
