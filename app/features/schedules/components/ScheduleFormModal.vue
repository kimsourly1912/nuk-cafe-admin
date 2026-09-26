<script setup lang="ts">
/**
 * Create/edit form. Open via `useOverlay().create(ScheduleFormModal)`; emits `close(true)` when saved.
 *
 * Editing also loads the schedule's detail to show which menu items follow it (read-only: links
 * are made in the menu-item form, and a save never sends them).
 *
 * Like the category form, it stays open while saving but can be closed: the save continues, and
 * a failure offers "Reopen" with the input restored.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { Schedule } from '#shared/contracts/menu'
import { useScheduleDetail, useScheduleMutations } from '../composables/useSchedules'
import { scheduleFormSchema, toCreateScheduleBody, toScheduleForm, toUpdateScheduleBody } from '../schemas/schedule-form'
import type { ScheduleForm } from '../schemas/schedule-form'
import { DAY_VALUES, DAYS, WEEKDAYS, WEEKEND } from '../utils/days'
import { formatTime, parseTime } from '../utils/time'
import { describeZone } from '../utils/timezone'
import ScheduleFormModal from './ScheduleFormModal.vue'

const props = defineProps<{
  /** A list row. Omit to create a new schedule. */
  schedule?: Schedule
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: ScheduleForm
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// straight to the overlay.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const isEdit = props.schedule !== undefined
// Local wall time at the cafe, not converted to the viewer's zone (D41).
const zone = props.schedule?.timeZone ?? useRuntimeConfig().public.cafeTimeZone
const timeHint = `Times are cafe time: ${describeZone(zone)}.`

const state = reactive<ScheduleForm>({ ...(props.draft ?? toScheduleForm(props.schedule)) })

const detail = props.schedule ? useScheduleDetail(props.schedule.id) : undefined

const { create, update } = useScheduleMutations()
const saving = ref(false)

// Compared with the form's original values (not the draft), so a reopened draft counts as unsaved.
const unsaved = useModalUnsavedChanges(state, {
  initial: toScheduleForm(props.schedule),
  paused: saving,
  close: () => emit('close', false),
})

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

// UInputTime works with `Time` objects; the form state keeps the API's `HH:mm` strings.
function timeModel(field: 'startTime' | 'endTime') {
  return computed({
    get: () => parseTime(state[field]),
    set: (time) => {
      state[field] = formatTime(time)
    },
  })
}
const startTime = timeModel('startTime')
const endTime = timeModel('endTime')

const dayPresets = [
  { label: 'Every day', days: DAY_VALUES },
  { label: 'Weekdays', days: WEEKDAYS },
  { label: 'Weekends', days: WEEKEND },
]

// If the user closes the modal mid-save, a failure offers to reopen it with their input.
let closed = false
onUnmounted(() => {
  closed = true
})
const overlay = useOverlay()
function reopenActions(draft: ScheduleForm) {
  if (!closed) return []
  return [{
    label: 'Reopen',
    onClick: () => overlay.create(ScheduleFormModal, { destroyOnClose: true }).open({ schedule: props.schedule, draft }),
  }]
}

async function onSubmit({ data }: FormSubmitEvent<ScheduleForm>) {
  const draft = { ...state, days: [...state.days] }
  const overrides = { errorActions: () => reopenActions(draft) }

  saving.value = true
  const result = props.schedule
    ? await update.execute({ id: props.schedule.id, name: data.name, body: toUpdateScheduleBody(data, props.schedule) }, overrides)
    : await create.execute(toCreateScheduleBody(data), overrides)
  saving.value = false

  if (!result.ok) return
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <UModal
    :title="isEdit ? 'Edit schedule' : 'New schedule'"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="schedule-form"
        ref="form"
        :schema="scheduleFormSchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Name"
          name="name"
          required
        >
          <UInput
            v-model="state.name"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField
          label="Description"
          name="description"
        >
          <UTextarea
            v-model="state.description"
            :rows="2"
            autoresize
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Days"
          name="days"
          required
        >
          <UCheckboxGroup
            v-model="state.days"
            :items="DAYS"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-x-4 gap-y-2' }"
          />
          <div class="mt-1 flex gap-1">
            <UButton
              v-for="preset in dayPresets"
              :key="preset.label"
              :label="preset.label"
              size="xs"
              variant="link"
              class="px-1"
              @click="state.days = [...preset.days]"
            />
          </div>
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField
            label="Start time"
            name="startTime"
            required
          >
            <UInputTime
              v-model="startTime"
              :hour-cycle="12"
              aria-label="Start time"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="End time"
            name="endTime"
            required
          >
            <UInputTime
              v-model="endTime"
              :hour-cycle="12"
              aria-label="End time"
              class="w-full"
            />
          </UFormField>
        </div>
        <p class="-mt-2 text-xs text-muted">
          {{ timeHint }}
        </p>

        <UFormField
          label="Status"
          name="status"
          required
        >
          <USelect
            v-model="state.status"
            :items="STATUS_ITEMS"
            class="w-full"
          />
        </UFormField>

        <div
          v-if="detail"
          class="space-y-1"
        >
          <p class="text-sm font-medium">
            Menu items
          </p>
          <ApiErrorAlert
            v-if="detail.error.value"
            :error="detail.error.value"
            title="Could not load this schedule's menu items"
            @retry="detail.refresh()"
          />
          <p
            v-else-if="detail.loading.value"
            class="text-sm text-muted"
          >
            Loading menu items…
          </p>
          <template v-else>
            <div
              v-if="detail.data.value?.products.length"
              class="flex flex-wrap gap-1"
            >
              <UBadge
                v-for="product in detail.data.value.products"
                :key="product.id"
                color="neutral"
                variant="subtle"
              >
                {{ product.name }}
                <span
                  v-if="product.status === 'INACTIVE'"
                  class="font-normal text-dimmed"
                >(inactive)</span>
              </UBadge>
            </div>
            <p
              v-else
              class="text-sm text-muted"
            >
              No menu items use this schedule.
            </p>
            <p class="text-xs text-muted">
              Menu items are linked from their own form.
            </p>
          </template>
        </div>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <span
          v-if="saving"
          class="mr-auto text-xs text-muted"
        >
          You can close this; saving continues in the background.
        </span>
        <UButton
          :label="saving ? 'Close' : 'Cancel'"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UTooltip
          :text="isEdit ? 'Save' : 'Create'"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="schedule-form"
            :label="isEdit ? 'Save' : 'Create'"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>
