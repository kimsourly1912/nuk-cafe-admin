<script setup lang="ts">
/**
 * A new option set: its name and first values, in order, saved in one request. Values are added,
 * renamed, archived and reordered afterwards in the editor. Open via
 * `useOverlay().create(OptionSetCreateModal)`; emits `close(set)` with the created set.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { OptionSet } from '#shared/contracts/menu-options'
import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import { useOptionSetMutations } from '../composables/useOptionSets'
import type { OptionSetForm } from '../schemas/option-set-form'
import { optionSetFormSchema, toCreateOptionSetBody, toOptionSetForm } from '../schemas/option-set-form'

const emit = defineEmits<{ 'close': [created?: OptionSet], 'update:open': [open: boolean] }>()

const state = reactive<OptionSetForm>(toOptionSetForm())
const { create } = useOptionSetMutations()
const saving = ref(false)

const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close') })

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

const list = useTemplateRef<HTMLElement>('list')
async function addValue() {
  state.values.push('')
  await nextTick()
  list.value?.querySelectorAll('input')[state.values.length - 1]?.focus()
}

async function onSubmit({ data }: FormSubmitEvent<OptionSetForm>) {
  saving.value = true
  const result = await create.execute(toCreateOptionSetBody(data))
  saving.value = false
  if (!result.ok) return
  unsaved.markClean()
  emit('close', result.data)
}
</script>

<template>
  <UModal
    title="New option set"
    description="Names only: each menu item sets its own price per version."
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="option-set-form"
        ref="form"
        :schema="optionSetFormSchema"
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
          help="e.g. Size, Temperature, Milk type"
        >
          <UInput
            v-model="state.name"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField
          label="Values"
          name="values"
          required
        >
          <div
            ref="list"
            class="space-y-2"
          >
            <UFormField
              v-for="(_, i) in state.values"
              :key="i"
              :name="`values.${i}`"
            >
              <div class="flex gap-2">
                <UInput
                  v-model="state.values[i]"
                  :aria-label="`Value ${i + 1}`"
                  class="flex-1"
                  @keydown.enter.prevent="i === state.values.length - 1 && state.values.length < MAX_OPTION_VALUES ? addValue() : undefined"
                />
                <UButton
                  v-if="state.values.length > 1"
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  :aria-label="`Remove value ${i + 1}`"
                  @click="state.values.splice(i, 1)"
                />
              </div>
            </UFormField>
            <UButton
              label="Add value"
              icon="i-lucide-plus"
              size="sm"
              variant="soft"
              :disabled="state.values.length >= MAX_OPTION_VALUES"
              @click="addValue"
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
            form="option-set-form"
            label="Create"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>
