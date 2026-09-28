<script setup lang="ts">
/**
 * Add or edit one add-on (D75): name, default price and pre-selected, saved in one call. The same
 * form for both; full screen on phones. The group's rules are checked before sending (a name used
 * by another active add-on, a price over the limit, more pre-selected than the maximum), and the
 * server's field errors land on their fields. The modal stays open on an error, input kept.
 * Open via `useOverlay().create(AddOnFormModal)`; emits `close(group)` with the group as saved.
 */
import type { Modifier, ModifierGroup } from '#shared/contracts/menu-modifiers'
import { useModifierGroupMutations } from '../composables/useModifierGroups'
import type { AddOnForm, AddOnIssues } from '../schemas/modifier-group-form'
import { addOnIssues, toAddOnFields, toAddOnForm } from '../schemas/modifier-group-form'

const props = defineProps<{
  group: ModifierGroup
  /** The add-on to edit; omit to add one. */
  modifier?: Modifier
}>()
const emit = defineEmits<{ 'close': [saved?: ModifierGroup], 'update:open': [open: boolean] }>()

const state = reactive<AddOnForm>(toAddOnForm(props.modifier))
const saving = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close') })

const { addModifier, updateModifier } = useModifierGroupMutations()

// Checked as the user types, shown once a field was touched or a save was tried.
const issues = computed(() => addOnIssues(state, props.group, props.modifier))
const touched = reactive({ name: false, price: false, isDefault: false, all: false })
/** The server's answer, by field, until that field changes. */
const serverIssues = ref<AddOnIssues>({})
const serverError = ref<string>()
watch(() => state.name, () => (serverIssues.value.name = undefined))
watch(() => state.price, () => (serverIssues.value.price = undefined))
watch(() => state.isDefault, () => (serverIssues.value.isDefault = undefined))

const shown = (field: keyof AddOnIssues) => serverIssues.value[field] ?? ((touched[field] || touched.all) ? issues.value[field] : undefined)

async function save() {
  touched.all = true
  if (Object.keys(issues.value).length || saving.value) return
  saving.value = true
  serverError.value = undefined
  const fields = toAddOnFields(state)
  const result = props.modifier
    ? await updateModifier.execute({ group: props.group, modifier: props.modifier, fields })
    : await addModifier.execute({ group: props.group, fields })
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    emit('close', result.data)
    return
  }
  if (result.status !== 'error') return
  const fieldErrors = result.error.fieldErrors ?? {}
  serverIssues.value = {
    name: fieldErrors.name?.[0],
    price: fieldErrors.priceDeltaMinor?.[0],
    isDefault: fieldErrors.modifiers?.[0] ?? fieldErrors.isDefault?.[0],
  }
  if (!Object.values(serverIssues.value).some(Boolean)) serverError.value = result.error.message
}

useSubmitShortcut(save)
</script>

<template>
  <UModal
    :title="modifier ? 'Edit add-on' : 'Add add-on'"
    :description="`In “${group.name}”. Menu items can set their own price.`"
    :fullscreen="fullscreen"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <form
        id="add-on-form"
        class="space-y-4"
        novalidate
        @submit.prevent="save"
      >
        <UAlert
          v-if="serverError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="The add-on wasn't saved"
          :description="serverError"
        />
        <UFormField
          label="Name"
          required
          :error="shown('name')"
        >
          <UInput
            v-model="state.name"
            :disabled="saving"
            autocomplete="off"
            class="w-full"
            autofocus
            @blur="touched.name = true"
          />
        </UFormField>
        <UFormField
          label="Default price"
          help="Leave empty for free."
          :error="shown('price')"
        >
          <UInputNumber
            :model-value="state.price"
            :format-options="PRICE_FORMAT"
            :min="0"
            :step="0.05"
            :disabled="saving"
            placeholder="Free"
            inputmode="decimal"
            aria-label="Default price"
            class="w-40"
            @update:model-value="value => state.price = value ?? undefined"
            @blur="touched.price = true"
          />
        </UFormField>
        <UFormField :error="shown('isDefault')">
          <UCheckbox
            v-model="state.isDefault"
            label="Preselected"
            description="Chosen for the customer unless they change it."
            :disabled="saving"
            @update:model-value="touched.isDefault = true"
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
          :text="modifier ? 'Save' : 'Add'"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="add-on-form"
            :label="modifier ? 'Save' : 'Add add-on'"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>
