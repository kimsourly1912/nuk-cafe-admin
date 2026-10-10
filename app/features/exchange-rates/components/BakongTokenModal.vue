<script setup lang="ts">
/**
 * Payments → Automatic check → Add or Replace token (T2d, D148): the cafe's own Bakong token,
 * pasted from Bakong's developer portal. It's sent once and stored encrypted; nothing shows it
 * again, only when it expires. The server refuses one that has already expired, on its field.
 * The field isn't checked as it's typed: a token is pasted and saved at once, and that check,
 * run 300 ms after the paste, came after the server's answer and wiped its error (D149).
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import { BAKONG_TOKEN_MAX, bakongTokenSchema } from '#shared/contracts/orders'
import { useKhqrSettingsMutations } from '../composables/useExchangeRates'

const props = defineProps<{
  /** The token's version when replacing one; 0 for the first. */
  version: number
}>()
const emit = defineEmits<{ close: [saved: boolean] }>()

const schema = v.pick(bakongTokenSchema, ['token'])
const initial = { token: '' }
const state = reactive({ ...initial })
const { saveToken } = useKhqrSettingsMutations()
const saving = ref(false)
const form = useTemplateRef('form')

const unsaved = useModalUnsavedChanges(state, {
  initial,
  paused: saving,
  close: () => emit('close', false),
})

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  saving.value = true
  const result = await saveToken.execute({ version: props.version, token: data.token })
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    emit('close', true)
    return
  }
  if (result.status === 'error') {
    form.value?.setErrors(Object.entries(result.error.fieldErrors ?? {})
      .flatMap(([name, messages]) => (messages[0] ? [{ name, message: messages[0] }] : [])))
  }
}
</script>

<template>
  <UModal
    :title="version ? 'Replace the Bakong token' : 'Add the Bakong token'"
    description="With a token, the counter records a KHQR payment as soon as Bakong confirms it."
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="bakong-token-form"
        ref="form"
        :schema="schema"
        :state="state"
        :disabled="saving"
        :validate-on="['blur', 'change']"
        @submit="onSubmit"
      >
        <UFormField
          label="Token"
          name="token"
          help="Copy it from Bakong's developer portal (api-bakong.nbc.gov.kh). It's stored encrypted and never shown again; tokens last 90 days."
          required
        >
          <UTextarea
            v-model="state.token"
            :maxlength="BAKONG_TOKEN_MAX"
            :rows="4"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            autofocus
            class="w-full font-mono text-xs"
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
          :disabled="saving"
          @click="unsaved.requestClose()"
        />
        <UButton
          type="submit"
          form="bakong-token-form"
          :label="version ? 'Replace token' : 'Save token'"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
