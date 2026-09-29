<script setup lang="ts">
/**
 * Branch settings (D91; page-patterns §3, the settings blueprint): one draft, one **Save changes**
 * that sends it whole. Status cards (open now, time zone, today's hours) show what's saved; the
 * Branch information and Weekly hours sections edit the draft. Save sits in the navbar from `lg`
 * (the page calls `save`, exposed) and in the bottom bar below it, while the draft has changes.
 * Leaving with changes asks first. Someone else's save (409) keeps the input and offers Reload.
 */
import type { FormErrorEvent } from '@nuxt/ui'
import type { BranchSettings } from '#shared/contracts/branches'
import { fetchBranchSettings, useBranchMutations } from '../composables/useBranches'
import type { BranchForm } from '../schemas/branch-form'
import { branchFormSchema, formFieldOf, isClosedAllWeek, toBranchForm, toUpdateBranchBody } from '../schemas/branch-form'
import { cityOf, timezoneOptions, utcOffset } from '../utils/timezones'
import BranchHoursEditor from './BranchHoursEditor.vue'

const props = defineProps<{ settings: BranchSettings }>()
const emit = defineEmits<{ saved: [settings: BranchSettings] }>()

/** The saved settings this draft is based on (its version is what Save names). */
const saved = shallowRef(props.settings)
const state = reactive<BranchForm>(toBranchForm(props.settings))
const saving = ref(false)
const unsaved = useUnsavedChanges(state, { paused: saving })

const { update } = useBranchMutations()
const form = useTemplateRef('form')

// --- Status cards: what's saved ---
const todaysHours = computed(() => {
  const windows = saved.value.hours.filter(w => w.weekday === saved.value.today)
  return windows.length ? windows.map(w => timeRange(w.startMinute, w.endMinute)).join(', ') : 'Closed today'
})

const zones = computed(() => timezoneOptions(state.timezone))

// --- Save ---
const conflict = ref(false)
const lastError = ref<string>()

async function save() {
  await form.value?.submit()
}

async function onSubmit() {
  if (saving.value) return
  saving.value = true
  lastError.value = undefined
  conflict.value = false
  const result = await update.execute({ branchId: saved.value.id, body: toUpdateBranchBody(state, saved.value.version) })
  saving.value = false
  if (result.ok) {
    saved.value = result.data
    Object.assign(state, toBranchForm(result.data))
    unsaved.markClean()
    emit('saved', result.data)
    return
  }
  if (result.status !== 'error') return
  if (result.error.code === 'VERSION_CONFLICT') {
    conflict.value = true
    return
  }
  const fieldErrors = Object.entries(result.error.fieldErrors ?? {})
    .flatMap(([field, messages]) => (messages[0] ? [{ name: formFieldOf(state, field), message: messages[0] }] : []))
  form.value?.setErrors(fieldErrors)
  if (!fieldErrors.length) lastError.value = result.error.message
}

/** Someone else saved: take their version, keep this input, save again to overwrite. */
async function reload() {
  const latest = await fetchBranchSettings(saved.value.id).catch(() => undefined)
  if (!latest) return
  saved.value = latest
  conflict.value = false
  emit('saved', latest)
}

// Focus the first invalid field, once the form has re-enabled its inputs.
function onError(event: FormErrorEvent) {
  const id = event.errors[0]?.id
  if (id) requestAnimationFrame(() => document.getElementById(id)?.focus())
}

useSubmitShortcut(save)

defineExpose({ save, isDirty: unsaved.isDirty, saving })
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold text-highlighted">
        Branch settings
      </h2>
      <p class="text-sm text-muted">
        Customer-facing details and the hours used to decide when the branch is open.
      </p>
    </div>

    <!-- What's saved. Phones: one card, a row each (it would fill the first screen as three); from sm: three cards -->
    <dl class="divide-y divide-default rounded-lg border border-default sm:grid sm:grid-cols-3 sm:gap-4 sm:divide-y-0 sm:border-0">
      <div class="flex items-center gap-3 p-4 sm:rounded-lg sm:border sm:border-default">
        <UChip
          :color="saved.openNow ? 'success' : 'neutral'"
          standalone
          inset
          size="3xl"
          class="shrink-0"
        />
        <div class="flex flex-1 items-baseline justify-between gap-2 sm:block">
          <dt class="text-sm text-muted">
            Current status
          </dt>
          <dd class="font-semibold text-highlighted sm:text-lg">
            {{ saved.openNow ? 'Open now' : 'Closed now' }}
          </dd>
        </div>
      </div>
      <div class="flex items-center gap-3 p-4 sm:rounded-lg sm:border sm:border-default">
        <UIcon
          name="i-lucide-clock"
          class="size-5 shrink-0 text-muted sm:size-6"
        />
        <div class="flex min-w-0 flex-1 items-baseline justify-between gap-2 sm:block">
          <dt class="text-sm text-muted">
            Time zone
          </dt>
          <dd class="truncate font-semibold text-highlighted sm:text-lg">
            {{ utcOffset(saved.timezone) }}
            <span class="text-sm font-normal text-muted sm:block">{{ cityOf(saved.timezone) }}</span>
          </dd>
        </div>
      </div>
      <div class="flex items-center gap-3 p-4 sm:rounded-lg sm:border sm:border-default">
        <UIcon
          name="i-lucide-calendar"
          class="size-5 shrink-0 text-muted sm:size-6"
        />
        <div class="flex min-w-0 flex-1 items-baseline justify-between gap-2 sm:block">
          <dt class="text-sm text-muted">
            Today's hours
          </dt>
          <dd class="font-semibold text-highlighted sm:text-lg">
            {{ todaysHours }}
          </dd>
        </div>
      </div>
    </dl>

    <UAlert
      v-if="conflict"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Someone else changed these settings"
      description="Reload to base your changes on theirs (your input stays), then save again."
      :actions="[{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }]"
    />
    <UAlert
      v-if="lastError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Not saved"
      :description="lastError"
    />
    <UAlert
      v-if="isClosedAllWeek(state)"
      color="warning"
      variant="subtle"
      icon="i-lucide-store"
      title="Closed every day"
      description="Customers can only order while the branch is open. Switch on the days it opens."
    />

    <UForm
      id="branch-settings-form"
      ref="form"
      :schema="branchFormSchema"
      :state="state"
      :validate-on="['input', 'change']"
      :disabled="saving"
      class="grid items-start gap-6 lg:grid-cols-5"
      @submit="onSubmit"
      @error="onError"
    >
      <UCard
        variant="outline"
        class="lg:col-span-2"
      >
        <section
          aria-labelledby="branch-information"
          class="space-y-4"
        >
          <div>
            <h3
              id="branch-information"
              class="font-semibold text-highlighted"
            >
              Branch information
            </h3>
            <p class="text-sm text-muted">
              Shown to customers on the online menu.
            </p>
          </div>
          <UFormField
            label="Branch name"
            name="name"
            required
          >
            <UInput
              v-model="state.name"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Address"
            name="address"
          >
            <UTextarea
              v-model="state.address"
              :rows="2"
              autoresize
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Phone"
            name="phone"
          >
            <UInput
              v-model="state.phone"
              type="tel"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Time zone"
            name="timezone"
            required
            help="Opening hours and menu availability follow this clock."
          >
            <USelectMenu
              v-model="state.timezone"
              :items="zones"
              value-key="value"
              :search-input="{ placeholder: 'Search time zones…' }"
              aria-label="Time zone"
              class="w-full"
            />
          </UFormField>
        </section>
      </UCard>

      <UCard
        variant="outline"
        class="lg:col-span-3"
      >
        <BranchHoursEditor
          :model-value="state"
          :disabled="saving"
        />
      </UCard>
    </UForm>

    <!-- Phones and tablets: Save at the bottom while there are changes (from lg it's in the navbar) -->
    <BottomActionBar
      label="Save"
      :open="unsaved.isDirty.value || saving"
      expanded="hidden"
    >
      <p class="min-w-0 flex-1 text-sm text-muted">
        Unsaved changes
      </p>
      <UButton
        type="submit"
        form="branch-settings-form"
        label="Save changes"
        icon="i-lucide-save"
        :loading="saving"
      />
    </BottomActionBar>
  </div>
</template>
