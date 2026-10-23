<script setup lang="ts">
/**
 * Add a branch (D197): its name and time zone; address, phone, hours and tables are set on its page,
 * which opens after the save. Open via `useOverlay().create(NewBranchModal)`; emits `close(branch)`
 * with the branch as saved. A refused save (a name in use, the cafe's limit) shows inside the modal
 * with the input kept. Full screen on phones.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { BranchSettings } from '#shared/contracts/branches'
import { useBranchMutations } from '../composables/useBranches'
import { newBranchFormSchema, toCreateBranchBody } from '../schemas/branch-form'
import type { NewBranchForm } from '../schemas/branch-form'

const props = defineProps<{
  /** The time zone it starts with: another branch's (most branches of a cafe share one). */
  timezone?: string
}>()
const emit = defineEmits<{ 'close': [saved?: BranchSettings], 'update:open': [open: boolean] }>()

const start = (): NewBranchForm => ({ name: '', timezone: props.timezone ?? useRuntimeConfig().public.cafeTimeZone })
const state = reactive<NewBranchForm>(start())
const saving = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { initial: start(), paused: saving, close: () => emit('close') })
const zones = computed(() => timezoneOptions(start().timezone))

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

const { create } = useBranchMutations()
/** The last refused save, shown here: toasts are out of reach while the modal is open. */
const lastError = ref<string>()

async function onSubmit({ data }: FormSubmitEvent<NewBranchForm>) {
  lastError.value = undefined
  saving.value = true
  const result = await create.execute(toCreateBranchBody(data))
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
  <UModal
    title="Add branch"
    description="It shares the cafe's menu, staff and customers. Set its opening hours next: it takes no orders until then."
    :fullscreen="fullscreen"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="new-branch-form"
        ref="form"
        :schema="newBranchFormSchema"
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
          title="Not added"
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
            virtualize
            aria-label="Time zone"
            class="w-full"
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
          text="Add branch"
          :kbds="['meta', 'enter']"
        >
          <UButton
            type="submit"
            form="new-branch-form"
            label="Add branch"
            :loading="saving"
          />
        </UTooltip>
      </div>
    </template>
  </UModal>
</template>
