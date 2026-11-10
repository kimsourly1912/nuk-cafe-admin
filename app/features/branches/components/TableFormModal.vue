<script setup lang="ts">
/**
 * Add a table or change its name, area and seats (D91; D273: the shop designer draws its chairs).
 * Full screen on phones; stays open on an error with the input kept, the server's field errors on
 * their fields. A new table gets its QR code at once. Open via `useOverlay().create(TableFormModal)`; emits `close(table)` with the table as saved.
 */
import type { DiningTable } from '#shared/contracts/branches'
import { TABLE_AREA_MAX, TABLE_LABEL_MAX, TABLE_SEATS_DEFAULT, TABLE_SEATS_MAX, TABLE_SEATS_MIN } from '#shared/contracts/branches'
import { useTableMutations } from '../composables/useBranches'
import type { TablesSurface } from '../composables/useBranches'

const props = defineProps<{
  branchId: string
  /** The table to edit; omit to add one. */
  table?: DiningTable
  /** The counter's API for a manager (D198); the admin's by default. */
  surface?: TablesSurface
}>()
const emit = defineEmits<{ 'close': [saved?: DiningTable], 'update:open': [open: boolean] }>()

const state = reactive({ label: props.table?.label ?? '', area: props.table?.area ?? '', seats: props.table?.seats ?? TABLE_SEATS_DEFAULT })
const saving = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close') })
const { create, update } = useTableMutations(props.surface)

const touched = ref(false)
const labelIssue = computed(() => {
  const label = state.label.trim()
  if (!label) return 'Name is required'
  if (label.length > TABLE_LABEL_MAX) return `Max ${TABLE_LABEL_MAX} characters`
  return undefined
})
const areaIssue = computed(() => (state.area.trim().length > TABLE_AREA_MAX ? `Max ${TABLE_AREA_MAX} characters` : undefined))
const seatsIssue = computed(() => {
  const seats = state.seats
  if (!Number.isInteger(seats) || seats < TABLE_SEATS_MIN || seats > TABLE_SEATS_MAX) return `${TABLE_SEATS_MIN} to ${TABLE_SEATS_MAX} people`
  return undefined
})
/** The server's answer, until the field changes. */
const serverIssues = ref<{ label?: string, area?: string, seats?: string }>({})
const serverError = ref<string>()
watch(() => state.label, () => (serverIssues.value.label = undefined))
watch(() => state.area, () => (serverIssues.value.area = undefined))
watch(() => state.seats, () => (serverIssues.value.seats = undefined))

async function save() {
  touched.value = true
  if (labelIssue.value || areaIssue.value || seatsIssue.value || saving.value) return
  saving.value = true
  serverError.value = undefined
  const label = state.label.trim()
  const area = state.area.trim() || null
  const { seats } = state
  const result = props.table
    ? await update.execute({ table: props.table, body: { label, area, seats } })
    : await create.execute({ branchId: props.branchId, label, area, seats })
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    emit('close', result.data)
    return
  }
  if (result.status !== 'error') return
  const fieldErrors = result.error.fieldErrors ?? {}
  serverIssues.value = { label: fieldErrors.label?.[0], area: fieldErrors.area?.[0], seats: fieldErrors.seats?.[0] }
  if (!serverIssues.value.label && !serverIssues.value.area && !serverIssues.value.seats) serverError.value = result.error.message
}

useSubmitShortcut(save)
</script>

<template>
  <AppModal
    :title="table ? 'Edit table' : 'New table'"
    :description="table ? 'Its QR code stays the same.' : 'It gets its QR code at once.'"
    :fullscreen="fullscreen"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <form
        id="table-form"
        class="space-y-4"
        novalidate
        @submit.prevent="save"
      >
        <UAlert
          v-if="serverError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="The table wasn't saved"
          :description="serverError"
        />
        <UFormField
          label="Name"
          required
          help="As customers see it, e.g. Table 01 or Patio 2."
          :error="serverIssues.label ?? (touched ? labelIssue : undefined)"
        >
          <UInput
            v-model="state.label"
            :disabled="saving"
            autocomplete="off"
            class="w-full"
            autofocus
            @blur="touched = true"
          />
        </UFormField>
        <UFormField
          label="Area"
          help="Optional, e.g. Main floor or Outdoor."
          :error="serverIssues.area ?? areaIssue"
        >
          <UInput
            v-model="state.area"
            :disabled="saving"
            autocomplete="off"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Seats"
          help="How many people sit here. The shop designer draws as many chairs."
          :error="serverIssues.seats ?? seatsIssue"
        >
          <UInputNumber
            v-model="state.seats"
            :min="TABLE_SEATS_MIN"
            :max="TABLE_SEATS_MAX"
            :disabled="saving"
            class="w-full"
          />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UTooltip
          :text="table ? 'Save' : 'Add table'"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="table-form"
            :label="table ? 'Save' : 'Add table'"
            :loading="saving"
            :disabled="Boolean(table) && !unsaved.isDirty.value"
          />
        </UTooltip>
      </div>
    </template>
  </AppModal>
</template>
