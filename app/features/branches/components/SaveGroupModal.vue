<script setup lang="ts">
/**
 * Save as group (plan Phase 5, D284): a name for the selected pieces and walls, saved for the whole
 * cafe. Open via `useOverlay().create(SaveGroupModal)` with the pieces; emits `close(group)` once
 * saved. A refused save (a name in use, the cafe's limit) shows inside the modal, the name kept.
 */
import * as v from 'valibot'
import type { FormSubmitEvent } from '@nuxt/ui'
import { LAYOUT_GROUP_NAME_MAX } from '#shared/contracts/shop-layout'
import type { LayoutGroup, LayoutItem, Wall } from '#shared/contracts/shop-layout'
import { useLayoutGroupMutations } from '../composables/useBranches'

const props = defineProps<{
  items: LayoutItem[]
  walls: Wall[]
}>()
const emit = defineEmits<{ 'close': [saved?: LayoutGroup], 'update:open': [open: boolean] }>()

const schema = v.object({ name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(LAYOUT_GROUP_NAME_MAX)) })
type GroupForm = v.InferOutput<typeof schema>
const state = reactive<GroupForm>({ name: '' })
const saving = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { initial: { name: '' }, paused: saving, close: () => emit('close') })

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

const { create } = useLayoutGroupMutations()
/** The last refused save, shown here: toasts are out of reach while the modal is open. */
const lastError = ref<string>()
const summary = computed(() => [props.items.length && `${props.items.length} ${props.items.length === 1 ? 'piece' : 'pieces'}`, props.walls.length && `${props.walls.length} ${props.walls.length === 1 ? 'wall' : 'walls'}`].filter(Boolean).join(' and '))

async function onSubmit({ data }: FormSubmitEvent<GroupForm>) {
  lastError.value = undefined
  saving.value = true
  const result = await create.execute({ name: data.name, items: props.items, walls: props.walls })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') lastError.value = result.error.message
    return
  }
  unsaved.markClean()
  emit('close', result.data)
}
</script>

<template>
  <AppModal
    title="Save as group"
    :description="`${summary}, to place again on any floor of any branch. Tables are never in a group: each has its own QR code.`"
    :fullscreen="fullscreen"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="save-group-form"
        ref="form"
        :schema="schema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UAlert
          v-if="lastError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Not saved"
          :description="lastError"
        />
        <UFormField
          label="Name"
          name="name"
          required
        >
          <UInput
            v-model="state.name"
            class="w-full"
            autofocus
            :maxlength="LAYOUT_GROUP_NAME_MAX"
          />
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
          text="Save group"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="save-group-form"
            label="Save group"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </AppModal>
</template>
