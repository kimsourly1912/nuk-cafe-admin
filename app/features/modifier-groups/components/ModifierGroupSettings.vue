<script setup lang="ts">
/**
 * The group page's settings panel (D75): name, Optional / Required, minimum and maximum (or no
 * maximum), the rule the customer will see (derived, never stored), status with Archive / Restore,
 * and when it was last updated. The page owns the draft, its checks and Save changes.
 */
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIERS } from '#shared/contracts/menu-modifiers'
import { describeRules, explainRules } from '../schemas/modifier-group-display'
import type { GroupSettingsForm, SettingsIssues } from '../schemas/modifier-group-form'

const props = defineProps<{
  group: ModifierGroup
  issues: SettingsIssues
  readOnly?: boolean
  busy?: boolean
}>()
const emit = defineEmits<{ archive: [], restore: [] }>()
const form = defineModel<GroupSettingsForm>({ required: true })

const archived = computed(() => props.group.status === 'archived')
const kind = computed({
  get: () => (form.value.required ? 'required' : 'optional'),
  set: (value: string) => {
    form.value.required = value === 'required'
    if (form.value.required && !form.value.minSelect) form.value.minSelect = 1
  },
})
const noMaximum = computed({
  get: () => form.value.maxSelect === null,
  set: (value: boolean) => {
    form.value.maxSelect = value ? null : Math.max(form.value.required ? form.value.minSelect ?? 1 : 1, 1)
  },
})
const minimum = computed(() => (form.value.required ? form.value.minSelect ?? 0 : 0))
const ruleShown = computed(() => !props.issues.minSelect && !props.issues.maxSelect)

const updated = computed(() => new Date(props.group.updatedAt).toLocaleDateString('en-US', { dateStyle: 'medium' }))
</script>

<template>
  <section
    aria-labelledby="group-settings-heading"
    class="space-y-5"
  >
    <h2
      id="group-settings-heading"
      class="font-semibold text-highlighted"
    >
      Group settings
    </h2>

    <UFormField
      label="Group name"
      required
      :error="issues.name"
    >
      <UInput
        v-model="form.name"
        :disabled="readOnly"
        autocomplete="off"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Selection">
      <URadioGroup
        v-model="kind"
        :items="[{ label: 'Optional', value: 'optional' }, { label: 'Required', value: 'required' }]"
        orientation="horizontal"
        variant="table"
        :disabled="readOnly"
        aria-label="Selection"
      />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField
        label="Minimum selections"
        :error="issues.minSelect"
      >
        <UInputNumber
          v-if="form.required"
          v-model="form.minSelect"
          :min="1"
          :max="MAX_MODIFIERS"
          :disabled="readOnly"
          inputmode="numeric"
          aria-label="Minimum selections"
          class="w-full"
        />
        <p
          v-else
          class="py-1.5 text-sm text-muted"
        >
          0 (optional)
        </p>
      </UFormField>
      <UFormField
        label="Maximum selections"
        :error="issues.maxSelect"
      >
        <UInputNumber
          v-if="!noMaximum"
          :model-value="form.maxSelect ?? undefined"
          :min="1"
          :max="MAX_MODIFIERS"
          :disabled="readOnly"
          inputmode="numeric"
          aria-label="Maximum selections"
          class="w-full"
          @update:model-value="value => form.maxSelect = value ?? null"
        />
        <p
          v-else
          class="py-1.5 text-sm text-muted"
        >
          No maximum
        </p>
      </UFormField>
    </div>
    <UCheckbox
      v-model="noMaximum"
      label="No maximum"
      :disabled="readOnly"
    />

    <UAlert
      v-if="ruleShown"
      icon="i-lucide-info"
      color="neutral"
      variant="subtle"
      :title="describeRules(minimum, form.maxSelect)"
      :description="`${explainRules(minimum, form.maxSelect)} Menu items can override these rules.`"
    />

    <USeparator />

    <div class="space-y-3">
      <p class="text-sm font-medium text-highlighted">
        Status
      </p>
      <UBadge
        :label="archived ? 'Archived' : 'Active'"
        :icon="archived ? 'i-lucide-archive' : 'i-lucide-circle-check'"
        :color="archived ? 'neutral' : 'success'"
        variant="subtle"
      />
      <UButton
        v-if="archived"
        label="Restore group"
        icon="i-lucide-archive-restore"
        block
        :loading="busy"
        @click="emit('restore')"
      />
      <UButton
        v-else
        label="Archive group"
        icon="i-lucide-archive"
        color="error"
        variant="soft"
        block
        :disabled="busy"
        @click="emit('archive')"
      />
      <p class="text-sm text-muted">
        Last updated {{ updated }}
      </p>
    </div>
  </section>
</template>
