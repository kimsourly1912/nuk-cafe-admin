<script setup lang="ts">
/**
 * Create/edit a rule. Open via `useOverlay().create(AvailabilityRuleFormModal)`; emits `close(true)`
 * when saved. The form edits rows (days + start + end); each row becomes one window per day
 * (schemas/availability-rule-form.ts).
 *
 * Like the other forms it stays open while saving but can be closed: the save continues, and a
 * failure offers "Reopen" with the input restored. An overlap the server finds is shown on its row.
 *
 * Weekly agenda (D76): each row is a card with seven day toggles (and Weekdays / Weekend / Every day
 * / Clear presets, which only change that row's days), From and Until, and an "overnight" note when
 * it ends the next day; a read-only weekly preview follows. Full screen on phones. An archived rule
 * opens read-only with Restore.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { AvailabilityRule } from '#shared/contracts/menu-availability'
import { AVAILABILITY_RULE_NAME_MAX } from '#shared/contracts/menu-availability'
import { useAvailabilityRuleMutations } from '../composables/useAvailabilityRules'
import type { AvailabilityRuleForm } from '../schemas/availability-rule-form'
import { availabilityRuleFormSchema, rowOfWindow, toAvailabilityRuleForm, toCreateAvailabilityRuleBody, toUpdateAvailabilityRuleBody, toWindows } from '../schemas/availability-rule-form'
import { scheduleLines, timeRange, isOvernight, WEEKDAYS } from '../utils/windows'
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
/** Archived rules can't be edited (the server refuses): shown read-only, with Restore. */
const readOnly = props.rule?.status === 'archived'
const { isCompact: fullscreen } = useLayoutContext()
const copy = (form: AvailabilityRuleForm): AvailabilityRuleForm => ({ name: form.name, rows: form.rows.map(row => ({ ...row, days: [...row.days] })) })
const state = reactive<AvailabilityRuleForm>(copy(props.draft ?? toAvailabilityRuleForm(props.rule)))

const { create, update, restore } = useAvailabilityRuleMutations()
const saving = ref(false)

const unsaved = useModalUnsavedChanges(state, {
  initial: toAvailabilityRuleForm(props.rule),
  paused: saving,
  close: () => emit('close', false),
})

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

// UInputTime works with `Time` objects; the form keeps minutes after midnight (app/utils/clock.ts).
const toTime = minuteToTime
const toMinute = timeToMinute

function toggleDay(row: AvailabilityRuleForm['rows'][number], day: number) {
  row.days = row.days.includes(day) ? row.days.filter(d => d !== day) : [...row.days, day].sort((a, b) => a - b)
}

/** Presets change only this row's days. */
const PRESETS = [
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekend', days: [6, 7] },
  { label: 'Every day', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'Clear', days: [] },
]

/** "9:00 PM – 1:00 AM · next day" under a row that runs past midnight. */
function overnightNote(row: AvailabilityRuleForm['rows'][number]) {
  if (row.start === undefined || row.end === undefined || !isOvernight(row.start, row.end)) return undefined
  return `${timeRange(row.start, row.end)} · next day`
}

/** The complete rows, as the list will show them. */
const preview = computed(() => scheduleLines(toWindows({
  name: state.name,
  rows: state.rows.filter(row => row.days.length && row.start !== undefined && row.end !== undefined && row.start !== row.end),
})))

async function restoreRule() {
  if (!props.rule) return
  const result = await restore.execute(props.rule)
  if (result.ok) emit('close', true)
}

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
    :title="readOnly ? rule!.name : isEdit ? 'Edit availability rule' : 'New availability rule'"
    :description="readOnly ? 'Archived: restore it to edit its times.' : undefined"
    :fullscreen="fullscreen"
    :ui="{ content: 'sm:max-w-2xl', footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="availability-rule-form"
        ref="form"
        :schema="availabilityRuleFormSchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving || readOnly"
        class="space-y-6"
        @submit="onSubmit"
      >
        <UFormField
          label="Rule name"
          name="name"
          required
          help="For example: Breakfast, Lunch or Happy hour"
        >
          <UInput
            v-model="state.name"
            :maxlength="AVAILABILITY_RULE_NAME_MAX"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField
          label="Weekly times"
          name="rows"
          required
          :description="`Times use the cafe timezone: ${cafeZone}. If the end time is earlier than the start time, the schedule continues into the next day.`"
        >
          <div class="space-y-3">
            <fieldset
              v-for="(row, i) in state.rows"
              :key="i"
              :aria-label="`Time ${i + 1}`"
              class="space-y-3 rounded-lg border p-4"
              :class="rowErrors[i] ? 'border-error' : 'border-default'"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-highlighted">
                  Time {{ i + 1 }}
                </span>
                <UButton
                  v-if="state.rows.length > 1 && !readOnly"
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  :aria-label="`Remove time ${i + 1}`"
                  @click="state.rows.splice(i, 1)"
                />
              </div>

              <UFormField :name="`rows.${i}.days`">
                <div
                  role="group"
                  :aria-label="`Days of time ${i + 1}`"
                  class="flex flex-wrap gap-1.5"
                >
                  <UButton
                    v-for="day in WEEKDAYS"
                    :key="day.value"
                    :label="day.label"
                    :color="row.days.includes(day.value) ? 'primary' : 'neutral'"
                    :variant="row.days.includes(day.value) ? 'outline' : 'soft'"
                    :aria-pressed="row.days.includes(day.value)"
                    :disabled="saving || readOnly"
                    class="min-w-12 justify-center"
                    @click="toggleDay(row, day.value)"
                  >
                    <template #trailing>
                      <span
                        class="size-1.5 rounded-full"
                        :class="row.days.includes(day.value) ? 'bg-primary' : 'bg-transparent'"
                        aria-hidden="true"
                      />
                    </template>
                  </UButton>
                </div>
              </UFormField>
              <div
                v-if="!readOnly"
                class="flex flex-wrap gap-x-1"
              >
                <UButton
                  v-for="preset in PRESETS"
                  :key="preset.label"
                  :label="preset.label"
                  :aria-label="`${preset.label} for time ${i + 1}`"
                  color="neutral"
                  variant="link"
                  size="sm"
                  class="px-1"
                  :disabled="saving"
                  @click="row.days = [...preset.days]"
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
                v-if="overnightNote(row)"
                class="flex items-center gap-1.5 text-sm text-muted"
              >
                <UIcon
                  name="i-lucide-moon"
                  class="size-4 shrink-0"
                />
                {{ overnightNote(row) }}
              </p>
              <p
                v-if="rowErrors[i]"
                class="text-sm text-error"
              >
                {{ rowErrors[i] }}
              </p>
            </fieldset>
            <UButton
              v-if="!readOnly"
              label="Add another time"
              icon="i-lucide-plus"
              variant="soft"
              @click="addRow"
            />
          </div>
        </UFormField>

        <section
          v-if="preview.length"
          aria-labelledby="availability-preview-heading"
          class="space-y-2"
        >
          <h3
            id="availability-preview-heading"
            class="text-sm font-medium text-highlighted"
          >
            Weekly preview
          </h3>
          <ul class="space-y-1 text-sm">
            <li
              v-for="line in preview"
              :key="`${line.days} ${line.times}`"
              class="flex flex-wrap gap-x-1.5"
            >
              <span class="text-muted">{{ line.days }}</span>
              <span aria-hidden="true">·</span>
              <span class="tabular-nums">{{ line.times }}</span>
              <span
                v-if="line.nextDay"
                class="text-muted"
              >· next day</span>
            </li>
          </ul>
        </section>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <template v-if="readOnly">
          <UButton
            label="Close"
            color="neutral"
            variant="outline"
            @click="emit('close', false)"
          />
          <UButton
            label="Restore"
            icon="i-lucide-archive-restore"
            :loading="restore.isPending(rule!.id)"
            @click="restoreRule()"
          />
        </template>
        <template v-else>
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
        </template>
      </div>
    </template>
  </UModal>
</template>
