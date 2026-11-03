<script setup lang="ts">
/**
 * A new add-on group: its name, how many customers choose, and its first add-ons with default
 * prices, saved in one request. The form applies the server's selection rules with the same
 * messages. Open via `useOverlay().create(ModifierGroupCreateModal)`; emits `close(group)`.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { MAX_MODIFIERS } from '#shared/contracts/menu-modifiers'
import { useModifierGroupMutations } from '../composables/useModifierGroups'
import type { ModifierGroupForm } from '../schemas/modifier-group-form'
import { describeRules } from '../schemas/modifier-group-display'
import { modifierGroupFormSchema, toCreateModifierGroupBody, toModifierGroupForm } from '../schemas/modifier-group-form'

const emit = defineEmits<{ 'close': [created?: ModifierGroup], 'update:open': [open: boolean] }>()

const state = reactive<ModifierGroupForm>(toModifierGroupForm())
const { create } = useModifierGroupMutations()
const saving = ref(false)

const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close') })

const form = useTemplateRef('form')
useFormErrorRecheck(form)
const rowErrors = useFormRowErrors(form, 'modifiers')
useSubmitShortcut(() => form.value?.submit())

const noLimit = computed({
  get: () => state.maxSelect === null,
  set: (value: boolean) => {
    state.maxSelect = value ? null : Math.max(1, state.minSelect)
  },
})

const list = useTemplateRef<HTMLElement>('list')
async function addRow() {
  state.modifiers.push({ name: '', price: undefined, isDefault: false })
  await nextTick()
  // Only the name inputs: the price steppers are text inputs too, so counting them focused a random row.
  list.value?.querySelectorAll<HTMLInputElement>('input[aria-label^="Add-on "]')[state.modifiers.length - 1]?.focus()
}

/** Removes an add-on; the ones after it move up, and their errors with them. */
function removeRow(index: number) {
  rowErrors.removeRow(state.modifiers, index)
}

async function onSubmit({ data }: FormSubmitEvent<ModifierGroupForm>) {
  saving.value = true
  const result = await create.execute(toCreateModifierGroupBody(data))
  saving.value = false
  if (!result.ok) return
  unsaved.markClean()
  emit('close', result.data)
}
</script>

<template>
  <AppModal
    :fullscreen="fullscreen"
    title="New add-on group"
    description="Extras customers can add, like milk or syrups, with default prices. Items can set their own."
    :ui="{ content: 'sm:max-w-xl' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="modifier-group-form"
        ref="form"
        :schema="modifierGroupFormSchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UFormField
          label="Name"
          name="name"
          required
          help="e.g. Milk, Extra shot, Syrups"
        >
          <UInput
            v-model="state.name"
            class="w-full"
            autofocus
          />
        </UFormField>

        <!-- Two equal columns so labels, steppers and errors line up; "No limit" sits under "At most"
             outside its field (inside, it would take the field's id, D165). -->
        <div class="grid grid-cols-2 items-start gap-x-3 gap-y-2">
          <UFormField
            label="At least"
            name="minSelect"
          >
            <UInputNumber
              v-model="state.minSelect"
              :min="0"
              :max="MAX_MODIFIERS"
              aria-label="At least"
              class="w-full"
            />
          </UFormField>
          <div class="space-y-2">
            <UFormField
              label="At most"
              name="maxSelect"
            >
              <UInputNumber
                :model-value="state.maxSelect ?? undefined"
                :min="1"
                :max="MAX_MODIFIERS"
                :disabled="noLimit"
                placeholder="No limit"
                aria-label="At most"
                class="w-full"
                @update:model-value="value => state.maxSelect = value ?? 1"
              />
            </UFormField>
            <UCheckbox
              v-model="noLimit"
              label="No limit"
            />
          </div>
        </div>
        <p class="text-xs text-muted">
          {{ describeRules(state.minSelect, state.maxSelect) }}
        </p>

        <UFormField
          label="Add-ons"
          name="modifiers"
          required
        >
          <div
            ref="list"
            class="space-y-3"
          >
            <!-- One card per add-on: the name and its remove button on top, price and pre-selected below
                 on a phone; all in one line from `sm`. -->
            <div
              v-for="(row, i) in state.modifiers"
              :key="i"
              class="grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-3 rounded-lg border border-default bg-elevated/40 p-3 sm:grid-cols-[1fr_auto_auto] sm:border-0 sm:bg-transparent sm:p-0"
            >
              <UFormField :name="`modifiers.${i}.name`">
                <UInput
                  v-model="row.name"
                  :aria-label="`Add-on ${i + 1}`"
                  placeholder="e.g. Oat milk"
                  class="w-full"
                />
              </UFormField>
              <!-- Remove comes last in the DOM so Tab goes name → price → pre-selected → remove; the grid
                   places it beside the name. -->
              <div class="col-span-2 row-start-2 flex items-start gap-4 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <UFormField :name="`modifiers.${i}.price`">
                  <UInputNumber
                    :model-value="row.price"
                    :format-options="PRICE_FORMAT"
                    :min="0"
                    :step="0.05"
                    placeholder="Free"
                    :aria-label="`Price of add-on ${i + 1}`"
                    class="w-32"
                    @update:model-value="value => row.price = value ?? undefined"
                  />
                </UFormField>
                <!-- Its own field: inside the Add-ons field it took that field's id (every label ticked the
                     first box) and turned red with the field's errors (D165, D166). -->
                <UFormField :name="`modifiers.${i}.isDefault`">
                  <UCheckbox
                    v-model="row.isDefault"
                    label="Pre-selected"
                    :aria-label="`Pre-select add-on ${i + 1}`"
                    class="pt-1.5"
                  />
                </UFormField>
              </div>
              <UButton
                v-if="state.modifiers.length > 1"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                class="col-start-2 row-start-1 sm:col-start-3"
                :aria-label="`Remove add-on ${i + 1}`"
                @click="removeRow(i)"
              />
            </div>
            <UButton
              label="Add another"
              icon="i-lucide-plus"
              size="sm"
              variant="soft"
              :disabled="state.modifiers.length >= MAX_MODIFIERS"
              @click="addRow"
            />
          </div>
        </UFormField>
      </UForm>
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
          text="Create"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="modifier-group-form"
            label="Create"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </AppModal>
</template>
