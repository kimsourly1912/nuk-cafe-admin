<script setup lang="ts">
/**
 * Create/edit a rule. Open via `useOverlay().create(AvailabilityRuleFormModal)`; emits `close(true)`
 * when saved. The form edits rows (days + start + end); each row becomes one window per day
 * (schemas/availability-rule-form.ts).
 *
 * Like the other forms it stays open while saving but can be closed: the save continues, and a
 * failure offers "Reopen" with the input restored. An overlap the server finds is shown on its row.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import { Time } from '@internationalized/date'
import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import { useAvailabilityRuleMutations } from '../composables/useAvailabilityRules'
import type { AvailabilityRuleForm } from '../schemas/availability-rule-form'
import { availabilityRuleFormSchema, rowOfWindow, toAvailabilityRuleForm, toCreateAvailabilityRuleBody, toUpdateAvailabilityRuleBody } from '../schemas/availability-rule-form'
import { WEEKDAYS } from '../utils/windows'
import AvailabilityRuleFormModal from './AvailabilityRuleFormModal.vue'

const props = defineProps<{
  /** A listed rule. Omit to create a new one. */
  rule?: AvailabilityRule
  /** Restores unsaved input (used by "Reopen" after a failed background save). */
  draft?: AvailabilityRuleForm
}>()

// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved`.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const isEdit = props.rule !== undefined
const copy = (form: AvailabilityRuleForm): AvailabilityRuleForm => ({ name: form.name, rows: form.rows.map(row => ({ ...row, days: [...row.days] })) })
const state = reactive<AvailabilityRuleForm>(copy(props.draft ?? toAvailabilityRuleForm(props.rule)))

const { create, update } = useAvailabilityRuleMutations()
const saving = ref(false)

const unsaved = useModalUnsavedChanges(state, {
  initial: toAvailabilityRuleForm(props.rule),
  paused: saving,
  close: () => emit('close', false),
})

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

// UInputTime works with `Time` objects; the form keeps minutes after midnight.
const toTime = (minute?: number) => (minute === undefined ? undefined : new Time(Math.floor(minute / 60), minute % 60))
function toMinute(time: unknown): number | undefined {
  if (!time || typeof time !== 'object' || !('hour' in time) || !('minute' in time)) return undefined
  return Number(time.hour) * 60 + Number(time.minute)
}

// Checkbox values are strings; the form keeps ISO weekday numbers.
const dayItems = WEEKDAYS.map(day => ({ label: day.label, value: String(day.value) }))
const toDays = (values: unknown) => (Array.isArray(values) ? values.map(Number).sort((a, b) => a - b) : [])

const cafeZone = useRuntimeConfig().public.cafeTimeZone

function addRow() {
  state.rows.push({ days: [], start: undefined, end: undefined })
}

/** An error the server reported for one row's window (an overlap), shown under that row. */
const rowErrors = ref<Record<number, string>>({})
watch(() => state.rows, () => {
  rowErrors.value = {}
}, { deep: true })

function showServerErrors(fieldErrors: Record<string, string[]> | undefined, submitted: AvailabilityRuleForm) {
  const errors: Record<number, string> = {}
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    const match = /^windows\.(\d+)/.exec(field)
    const row = match ? rowOfWindow(submitted, Number(match[1])) : undefined
    if (row !== undefined) errors[row] = messages[0] ?? 'Check this time'
  }
  rowErrors.value = errors
}

// If the user closes the modal mid-save, a failure offers to reopen it with their input.
let closed = false
onUnmounted(() => {
  closed = true
})
const overlay = useOverlay()
function reopenActions(draft: AvailabilityRuleForm) {
  if (!closed) return []
  return [{
    label: 'Reopen',
    onClick: () => overlay.create(AvailabilityRuleFormModal, { destroyOnClose: true }).open({ rule: props.rule, draft }),
  }]
}

async function onSubmit({ data }: FormSubmitEvent<AvailabilityRuleForm>) {
  const draft = copy(state)
  const overrides = { errorActions: () => reopenActions(draft) }

  saving.value = true
  const result = props.rule
    ? await update.execute({ id: props.rule.id, name: data.name, body: toUpdateAvailabilityRuleBody(data, props.rule) }, overrides)
    : await create.execute(toCreateAvailabilityRuleBody(data), overrides)
  saving.value = false

  if (!result.ok) {
    if (result.status === 'error') showServerErrors(result.error.fieldErrors, data)
    return
  }
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <UModal
    :title="isEdit ? 'Edit availability rule' : 'New availability rule'"
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="availability-rule-form"
        ref="form"
        :schema="availabilityRuleFormSchema"
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
          help="e.g. Breakfast, Lunch, Happy hour"
        >
          <UInput
            v-model="state.name"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField
          label="When"
          name="rows"
          required
          :help="`Times are cafe time (${cafeZone}). An end before the start runs into the next day; 12:00 AM as the end means midnight.`"
        >
          <div class="space-y-3">
            <fieldset
              v-for="(row, i) in state.rows"
              :key="i"
              :aria-label="`Time ${i + 1}`"
              class="space-y-2 rounded-md border p-3"
              :class="rowErrors[i] ? 'border-error' : 'border-default'"
            >
              <div class="flex items-start justify-between gap-2">
                <UFormField
                  :name="`rows.${i}.days`"
                  class="flex-1"
                >
                  <UCheckboxGroup
                    :model-value="row.days.map(String)"
                    :items="dayItems"
                    orientation="horizontal"
                    :aria-label="`Days of time ${i + 1}`"
                    :ui="{ fieldset: 'flex-wrap gap-x-3 gap-y-1' }"
                    @update:model-value="values => row.days = toDays(values)"
                  />
                </UFormField>
                <UButton
                  v-if="state.rows.length > 1"
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`Remove time ${i + 1}`"
                  @click="state.rows.splice(i, 1)"
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <UFormField
                  label="From"
                  :name="`rows.${i}.start`"
                >
                  <UInputTime
                    :model-value="toTime(row.start)"
                    :hour-cycle="12"
                    :aria-label="`Start of time ${i + 1}`"
                    class="w-full"
                    @update:model-value="time => row.start = toMinute(time)"
                  />
                </UFormField>
                <UFormField
                  label="Until"
                  :name="`rows.${i}.end`"
                >
                  <UInputTime
                    :model-value="toTime(row.end)"
                    :hour-cycle="12"
                    :aria-label="`End of time ${i + 1}`"
                    class="w-full"
                    @update:model-value="time => row.end = toMinute(time)"
                  />
                </UFormField>
              </div>
              <p
                v-if="rowErrors[i]"
                class="text-sm text-error"
              >
                {{ rowErrors[i] }}
              </p>
            </fieldset>
            <UButton
              label="Add another time"
              icon="i-lucide-plus"
              size="sm"
              variant="soft"
              @click="addRow"
            />
          </div>
        </UFormField>
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
            form="availability-rule-form"
            :label="isEdit ? 'Save' : 'Create'"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>
