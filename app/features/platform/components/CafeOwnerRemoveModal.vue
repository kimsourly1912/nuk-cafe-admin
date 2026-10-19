<script setup lang="ts">
/**
 * Remove an owner (step P2, D189): why, for the platform team. They keep their branch roles here,
 * if any, and are signed out everywhere. Opened only while another owner can sign in: the server
 * refuses otherwise (409 `LAST_OWNER`), and Transfer ownership is the way then.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import type { TenantDetail, TenantOwner } from '#shared/contracts/tenants'
import { OWNERSHIP_REASON_MAX, removeOwnerSchema } from '#shared/contracts/tenants'
import { useCafeMutations } from '../composables/useCafes'
import { removalLine } from '../schemas/owner-form'

const props = defineProps<{ cafe: TenantDetail, owner: TenantOwner }>()
const emit = defineEmits<{ close: [removed: boolean] }>()

const schema = v.pick(removeOwnerSchema, ['reason'])
const state = reactive({ reason: '' })
const form = useTemplateRef('form')
useFormErrorRecheck(form)
const { removeOwner } = useCafeMutations()
const saving = ref(false)

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  if (saving.value) return
  saving.value = true
  const result = await removeOwner.execute({ cafe: props.cafe, owner: props.owner, body: { version: props.cafe.version, reason: data.reason } })
  saving.value = false
  if (result.ok) emit('close', true)
}
</script>

<template>
  <UModal
    :title="`Remove ${owner.name} as an owner?`"
    :description="`${removalLine(owner)} They're signed out everywhere, in every cafe.`"
  >
    <template #body>
      <UForm
        id="remove-owner-form"
        ref="form"
        :schema="schema"
        :state="state"
        :disabled="saving"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UFormField
          label="Reason"
          name="reason"
          help="For the platform team: it isn't shown to the cafe."
          required
        >
          <UTextarea
            v-model="state.reason"
            :maxlength="OWNERSHIP_REASON_MAX"
            :rows="3"
            autoresize
            autofocus
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
          :disabled="saving"
          @click="emit('close', false)"
        />
        <UButton
          type="submit"
          form="remove-owner-form"
          label="Remove owner"
          color="error"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
