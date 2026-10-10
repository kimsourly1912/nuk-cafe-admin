<script setup lang="ts">
import { useIntervalFn, useNow } from '@vueuse/core'

/**
 * Offers back input kept from an earlier visit (D151): "Unsaved changes from 10:42 AM" with
 * **Restore** and **Discard**. Shows nothing when no draft is offered. When the record was saved by
 * someone after the draft, it says so: restoring puts the draft's values over theirs, and the save
 * still goes through the version check.
 *
 * @example
 * const unsaved = useUnsavedChanges(state, { draft: { key, version } })
 * // <FormDraftAlert :draft="unsaved.draft" record="menu item" />
 */
const props = defineProps<{
  draft: FormDraftOffer
  /** What the form edits, for the text ("menu item"). */
  record: string
}>()

const now = useNow({ scheduler: tick => useIntervalFn(tick, 60_000) })
const time = computed(() => (props.draft.savedAt === null ? '' : draftTimeText(props.draft.savedAt, now.value.getTime())))
</script>

<template>
  <UAlert
    v-if="draft.savedAt !== null"
    role="status"
    :color="draft.changedSince ? 'warning' : 'info'"
    variant="subtle"
    icon="i-lucide-history"
    :title="`Unsaved changes from ${time}`"
    :description="draft.changedSince
      ? `Someone saved this ${record} after that. Restoring puts your changes over theirs: check them before saving.`
      : `This browser kept what you typed. Restore it to carry on where you left off.`"
    :actions="[
      { label: 'Restore', icon: 'i-lucide-undo-2', onClick: () => draft.restore() },
      { label: 'Discard', color: 'neutral', variant: 'outline', onClick: () => draft.dismiss() },
    ]"
  />
</template>
