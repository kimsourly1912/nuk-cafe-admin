<script setup lang="ts">
/**
 * A new option set: its name and first values (1 to 20, each once), in order, saved in one
 * request. Values move with Move up / Move down (no drag here: a short list, D73). Full screen on
 * phones. Values are added, renamed, archived and reordered afterwards in the editor, which opens
 * after creation. Open via `useOverlay().create(OptionSetCreateModal)`; emits `close(set)`.
 */
import { useMediaQuery } from '@vueuse/core'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { OptionSet } from '#shared/contracts/menu-options'
import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import { useOptionSetMutations } from '../composables/useOptionSets'
import type { OptionSetForm } from '../schemas/option-set-form'
import { optionSetFormSchema, toCreateOptionSetBody, toOptionSetForm } from '../schemas/option-set-form'
import { moveEntry } from '../schemas/option-set-display'

const emit = defineEmits<{ 'close': [created?: OptionSet], 'update:open': [open: boolean] }>()

const state = reactive<OptionSetForm>(toOptionSetForm())
const { create } = useOptionSetMutations()
const saving = ref(false)
const fullscreen = useMediaQuery('(max-width: 639px)')

const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close') })

const form = useTemplateRef('form')
useSubmitShortcut(() => form.value?.submit())

const list = useTemplateRef<HTMLElement>('list')
async function addValue() {
  state.values.push('')
  await nextTick()
  list.value?.querySelectorAll('input')[state.values.length - 1]?.focus()
}

/** Moves a value and keeps focus on the button that moved it (or the other one at either end). */
async function moveValue(index: number, by: -1 | 1) {
  const to = index + by
  state.values = moveEntry(state.values, index, to)
  await nextTick()
  const row = list.value?.querySelectorAll<HTMLElement>('[data-value-row]')[to]
  const button = row?.querySelector<HTMLButtonElement>(by < 0 ? '[data-move=up]' : '[data-move=down]')
  const target = button && !button.disabled ? button : row?.querySelector<HTMLElement>('[data-move]:not(:disabled)')
  target?.focus()
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
    :fullscreen="fullscreen"
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
          help="Examples: Size, Temperature, Serving style"
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
          :help="`In the order customers see them. 1 to ${MAX_OPTION_VALUES} values, each listed once.`"
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
              <div
                class="flex items-center gap-1"
                data-value-row
              >
                <UInput
                  v-model="state.values[i]"
                  :aria-label="`Value ${i + 1}`"
                  class="flex-1"
                  @keydown.enter.prevent="i === state.values.length - 1 && state.values.length < MAX_OPTION_VALUES ? addValue() : undefined"
                />
                <UButton
                  icon="i-lucide-arrow-up"
                  color="neutral"
                  variant="ghost"
                  data-move="up"
                  :disabled="i === 0"
                  :aria-label="`Move value ${i + 1} up`"
                  @click="moveValue(i, -1)"
                />
                <UButton
                  icon="i-lucide-arrow-down"
                  color="neutral"
                  variant="ghost"
                  data-move="down"
                  :disabled="i === state.values.length - 1"
                  :aria-label="`Move value ${i + 1} down`"
                  @click="moveValue(i, 1)"
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
              variant="soft"
              :disabled="state.values.length >= MAX_OPTION_VALUES"
              @click="addValue"
            />
            <p
              v-if="state.values.length >= MAX_OPTION_VALUES"
              class="text-xs text-muted"
            >
              A set can have at most {{ MAX_OPTION_VALUES }} values.
            </p>
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
