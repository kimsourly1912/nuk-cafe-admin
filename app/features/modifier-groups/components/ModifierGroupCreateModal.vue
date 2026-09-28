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
  list.value?.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')[state.modifiers.length - 1]?.focus()
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
  <UModal
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

        <div class="flex flex-wrap items-end gap-3">
          <UFormField
            label="At least"
            name="minSelect"
          >
            <UInputNumber
              v-model="state.minSelect"
              :min="0"
              :max="MAX_MODIFIERS"
              aria-label="At least"
              class="w-28"
            />
          </UFormField>
          <UFormField
            label="At most"
            name="maxSelect"
          >
            <UInputNumber
              v-if="!noLimit"
              :model-value="state.maxSelect ?? undefined"
              :min="1"
              :max="MAX_MODIFIERS"
              aria-label="At most"
              class="w-28"
              @update:model-value="value => state.maxSelect = value ?? 1"
            />
            <p
              v-else
              class="flex h-8 items-center text-sm text-muted"
            >
              No limit
            </p>
          </UFormField>
          <UCheckbox
            v-model="noLimit"
            label="No limit"
            class="pb-1.5"
          />
        </div>
        <p class="-mt-2 text-xs text-muted">
          {{ describeRules(state.minSelect, state.maxSelect) }}
        </p>

        <UFormField
          label="Add-ons"
          name="modifiers"
          required
        >
          <div
            ref="list"
            class="space-y-2"
          >
            <div
              v-for="(row, i) in state.modifiers"
              :key="i"
              class="flex items-start gap-2"
            >
              <UFormField
                :name="`modifiers.${i}.name`"
                class="flex-1"
              >
                <UInput
                  v-model="row.name"
                  :aria-label="`Add-on ${i + 1}`"
                  class="w-full"
                />
              </UFormField>
              <UFormField :name="`modifiers.${i}.price`">
                <UInputNumber
                  :model-value="row.price"
                  :format-options="PRICE_FORMAT"
                  :min="0"
                  :step="0.05"
                  placeholder="Free"
                  :aria-label="`Price of add-on ${i + 1}`"
                  class="w-28"
                  @update:model-value="value => row.price = value ?? undefined"
                />
              </UFormField>
              <UCheckbox
                v-model="row.isDefault"
                label="Pre-selected"
                :aria-label="`Pre-select add-on ${i + 1}`"
                class="pt-1.5"
              />
              <UButton
                v-if="state.modifiers.length > 1"
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                :aria-label="`Remove add-on ${i + 1}`"
                @click="state.modifiers.splice(i, 1)"
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
  </UModal>
</template>
