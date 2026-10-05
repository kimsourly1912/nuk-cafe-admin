<script setup lang="ts">
import type { AssistantImportDraft, AssistantImportReviewRow } from '#shared/contracts/assistant-import'
import { assistantImportDraftSchema } from '#shared/contracts/assistant-import'
import { MAX_ITEM_OPTION_SETS, MAX_ITEM_MODIFIER_GROUPS } from '#shared/contracts/menu-items'
import { CategorySelect } from '~/features/categories'
import { AvailabilityRuleSelect } from '~/features/availability-rules'
import { useOptionSetOptions } from '~/features/option-sets'
import { useModifierGroupOptions } from '~/features/modifier-groups'
import { importGrid } from '../utils/import'

const props = defineProps<{
  row: AssistantImportReviewRow
  version: number
  disabled: boolean
  error?: ApiError
  apply: (draft: AssistantImportDraft, version: number) => Promise<boolean>
  reload: () => Promise<void>
}>()
const emit = defineEmits<{ close: [] }>()
const state = reactive(structuredClone(toRaw(props.row.draft)))
const initialVersion = props.version
const unsaved = useUnsavedChanges(state, { paused: () => props.disabled })
const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())
const formId = useId()
const { data: sets, error: setsError, refresh: refreshSets } = useOptionSetOptions()
const { data: groups, error: groupsError, refresh: refreshGroups } = useModifierGroupOptions()
const category = computed({ get: () => state.categoryId ?? undefined, set: (id: string | undefined) => {
  state.categoryId = id ?? null
} })
const optionIds = computed({ get: () => state.optionSetIds, set: (ids: string[]) => {
  state.variations = importGrid(state, ids, sets.value)
  state.optionSetIds = ids
} })
const groupIds = computed({ get: () => state.modifierGroups.map(g => g.groupId), set: (ids: string[]) => {
  state.modifierGroups = ids.map(id => state.modifierGroups.find(g => g.groupId === id) ?? { groupId: id, rules: null, prices: [] })
} })
const optionItems = computed(() => [
  ...state.optionSetIds.filter(id => !sets.value.some(s => s.id === id)).map(id => ({ label: 'Unavailable option set', value: id, disabled: false })),
  ...sets.value.map(s => ({ label: `${s.name}${s.status === 'archived' ? ' (archived)' : ''}`, value: s.id, disabled: (s.status !== 'active' && !state.optionSetIds.includes(s.id)) || (state.optionSetIds.length >= MAX_ITEM_OPTION_SETS && !state.optionSetIds.includes(s.id)) })),
])
const groupItems = computed(() => [
  ...groupIds.value.filter(id => !groups.value.some(g => g.id === id)).map(id => ({ label: 'Unavailable add-on group', value: id, disabled: false })),
  ...groups.value.map(g => ({ label: `${g.name}${g.status === 'archived' ? ' (archived)' : ''}`, value: g.id, disabled: (g.status !== 'active' && !groupIds.value.includes(g.id)) || (groupIds.value.length >= MAX_ITEM_MODIFIER_GROUPS && !groupIds.value.includes(g.id)) })),
])
function labelOf(ids: string[]) {
  return ids.map(id => sets.value.flatMap(s => s.values).find(v => v.id === id)?.name ?? 'Unavailable value').join(' · ') || 'Standard'
}
async function submit() {
  if (props.disabled) return
  if (await props.apply(structuredClone(toRaw(state)), initialVersion)) {
    unsaved.markClean()
    emit('close')
  }
}
watch(() => props.error, (error) => {
  if (error?.fieldErrors) form.value?.setErrors(Object.entries(error.fieldErrors).flatMap(([name, messages]) => messages[0] ? [{ name: name.replace(/^draft\./, ''), message: messages[0] }] : []))
})
const confirm = useConfirm()
async function requestReload() {
  if (unsaved.isDirty.value && !await confirm({ title: 'Reload this correction?', description: 'Your unsaved input will be replaced by the saved review.', confirmLabel: 'Reload', danger: true })) return
  await props.reload()
}
</script>

<template>
  <div class="space-y-6">
    <p class="text-sm text-muted">
      Apply saves this correction to your private review. It does not create a menu item.
    </p>
    <UAlert
      v-if="error"
      color="error"
      :title="error.message"
      :actions="error.kind === 'conflict' ? [{ label: 'Reload review', onClick: requestReload }] : undefined"
    />
    <section class="space-y-2">
      <h2 class="font-semibold text-highlighted">
        From the source
      </h2>
      <p class="break-words text-sm">
        {{ row.source.name }}<template v-if="row.source.category">
          · {{ row.source.category }}
        </template>
      </p>
      <p
        v-if="row.source.description"
        class="break-words text-sm text-muted"
      >
        {{ row.source.description }}
      </p>
      <ul class="space-y-1 text-sm text-muted">
        <li
          v-for="(price, i) in row.source.prices"
          :key="i"
        >
          {{ price.label ?? 'Price' }}: {{ price.evidence ?? 'No readable price' }} ({{ price.currency }})
        </li>
      </ul>
    </section>
    <UForm
      :id="formId"
      ref="form"
      :schema="assistantImportDraftSchema"
      :state="state"
      :disabled="disabled"
      :validate-on="['input', 'change']"
      class="space-y-4"
      @submit="submit"
    >
      <UFormField
        label="Name"
        name="name"
      >
        <UInput
          v-model="state.name"
          aria-label="Name"
          class="w-full"
          :maxlength="80"
        />
      </UFormField>
      <UFormField
        label="Description"
        name="description"
      >
        <UTextarea
          v-model="state.description"
          aria-label="Description"
          class="w-full"
          :maxlength="500"
        />
      </UFormField>
      <UFormField
        label="Category"
        name="categoryId"
        description="Choose an existing category before creating the draft."
      >
        <CategorySelect
          v-model="category"
          level="leaf"
          aria-label="Category"
        />
      </UFormField>
      <UFormField
        label="Options"
        name="optionSetIds"
        description="Choose existing options and check every version's price."
      >
        <RecordSelect
          v-model="optionIds"
          :items="optionItems"
          noun="option sets"
          placeholder="Choose options"
          class="w-full"
          multiple
          aria-label="Options"
        />
        <ApiErrorAlert
          v-if="setsError"
          :error="setsError"
          @retry="refreshSets()"
        />
      </UFormField>
      <section class="space-y-3">
        <h2 class="font-semibold text-highlighted">
          Prices in USD
        </h2>
        <p
          v-if="!state.variations.length"
          class="text-sm text-warning"
        >
          Choose options with active values, or clear Options for one standard price.
        </p>
        <div
          v-for="(cell, index) in state.variations"
          :key="cell.valueIds.join(',')"
          class="space-y-2 border-b border-default pb-3"
        >
          <p class="break-words text-sm font-medium">
            {{ labelOf(cell.valueIds) }}
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <UFormField
              :label="`Price for ${labelOf(cell.valueIds)}`"
              :name="`variations.${index}.priceMinor`"
            >
              <UInputNumber
                :model-value="cell.priceMinor === null ? null : fromMinor(cell.priceMinor)"
                :format-options="PRICE_FORMAT"
                :min="0"
                :max="1000"
                :step="0.01"
                :aria-label="`Price for ${labelOf(cell.valueIds)}`"
                @update:model-value="v => cell.priceMinor = v == null ? null : toMinor(v)"
              />
            </UFormField>
            <USwitch
              :model-value="cell.status === 'active'"
              :aria-label="`Offer ${labelOf(cell.valueIds)}`"
              @update:model-value="v => cell.status = v ? 'active' : 'disabled'"
            />
          </div>
        </div>
      </section>
      <UFormField
        label="Add-ons"
        name="modifierGroups"
        description="Uses each group's existing rules and prices. Adjust overrides through Menu items after creation."
      >
        <RecordSelect
          v-model="groupIds"
          :items="groupItems"
          noun="add-on groups"
          placeholder="Choose add-ons"
          class="w-full"
          multiple
          aria-label="Add-ons"
        />
        <ApiErrorAlert
          v-if="groupsError"
          :error="groupsError"
          @retry="refreshGroups()"
        />
      </UFormField>
      <UFormField
        label="Availability"
        name="availabilityRuleIds"
      >
        <AvailabilityRuleSelect
          v-model="state.availabilityRuleIds"
          aria-label="Availability"
        />
      </UFormField>
    </UForm>
    <BottomActionBar
      label="Review correction"
      expanded="pinned"
    >
      <UButton
        label="Back to review"
        color="neutral"
        variant="outline"
        :disabled="disabled"
        @click="emit('close')"
      />
      <UButton
        label="Apply to review"
        icon="i-lucide-save"
        type="submit"
        :form="formId"
        :loading="disabled"
        :disabled="disabled || !unsaved.isDirty.value"
      />
    </BottomActionBar>
  </div>
</template>
