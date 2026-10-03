<script setup lang="ts">
/**
 * Change a cafe's web address (D142). The old address keeps working: it redirects to the new one
 * (printed menus, bookmarks, links already sent), and no other cafe can take it. Printed table QR
 * codes don't change. The server refuses an address any other cafe has or had, on the field.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import type { TenantDetail } from '#shared/contracts/tenants'
import { changeTenantSlugSchema } from '#shared/contracts/tenants'
import { useCafeMutations } from '../composables/useCafes'

const props = defineProps<{ cafe: TenantDetail }>()
const emit = defineEmits<{ close: [moved: boolean] }>()

const schema = v.pick(changeTenantSlugSchema, ['slug'])
const state = reactive({ slug: props.cafe.slug })
const origin = import.meta.client ? window.location.origin : ''
const form = useTemplateRef('form')
const { changeSlug } = useCafeMutations()
const saving = ref(false)

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  saving.value = true
  const result = await changeSlug.execute({ cafe: props.cafe, body: { version: props.cafe.version, slug: data.slug } })
  saving.value = false
  if (result.ok) {
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
    title="Change web address"
    :description="`${cafe.name} is at /c/${cafe.slug}.`"
  >
    <template #body>
      <UForm
        id="address-form"
        ref="form"
        :schema="schema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField
          label="New address"
          name="slug"
          :help="`${origin}/c/${state.slug || '…'}`"
          required
        >
          <UInput
            v-model="state.slug"
            autocapitalize="none"
            spellcheck="false"
            autofocus
            class="w-full"
          >
            <template #leading>
              <span class="text-sm text-muted">/c/</span>
            </template>
          </UInput>
        </UFormField>
        <p class="text-sm text-muted">
          /c/{{ cafe.slug }} keeps working and sends people to the new address. Printed table QR codes don't change.
        </p>
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
          form="address-form"
          label="Change address"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
