<script setup lang="ts">
/**
 * The country menu of `PhoneInput`. It sits beside the number inside the form field, but the field's id,
 * name and label belong to the number: without this the menu would take over the field's id (a second
 * element with it, the label pointing at the menu) and its change events would validate the phone.
 * Providing no form field below this component keeps the menu out of it.
 */
import { formFieldInjectionKey } from '#ui/composables/useFormField'
import type { PhoneCountry } from '#shared/contracts/phone'

defineProps<{
  items: { label: string, value: PhoneCountry, icon: string }[]
  icon: string
  disabled?: boolean
}>()
const country = defineModel<PhoneCountry>({ required: true })
const id = useId()

provide(formFieldInjectionKey, undefined)
</script>

<template>
  <USelectMenu
    :id="id"
    v-model="country"
    :items="items"
    value-key="value"
    :disabled="disabled"
    aria-label="Country code"
    :search-input="{ placeholder: 'Search country...', icon: 'i-lucide-search' }"
    :filter-fields="['label']"
    :content="{ align: 'start' }"
    trailing-icon="i-lucide-chevrons-up-down"
    :ui="{ base: 'pe-8', content: 'w-64', placeholder: 'hidden', trailingIcon: 'size-4' }"
  >
    <UIcon
      :name="icon"
      class="size-5"
    />
  </USelectMenu>
</template>
