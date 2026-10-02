<script setup lang="ts">
/**
 * A phone number (D127): the country (a flag and its dial code, a fixed set: `USelect`) beside the
 * number, as one field. People type or paste anything; the form's schema decides what's valid
 * (`parsePhone` from `#shared/contracts/phone`, the same check the server makes), and the request
 * carries E.164. Typing or pasting a full number (`+855 12 345 678`, `00852…`, `85512345678`) switches
 * the country and keeps the local part; leaving the field drops a trunk 0 and groups the digits (`012345678` → `12 345 678`).
 *
 * Attributes (`aria-label`, `disabled`, …) go to the number's input.
 *
 * @example
 * <PhoneInput v-model="state.phone" v-model:country="state.phoneCountry" aria-label="Phone" />
 */
import type { PhoneCountry } from '#shared/contracts/phone'
import { parsePhone, PHONE_COUNTRIES, phoneCountryOf } from '#shared/contracts/phone'

defineOptions({ inheritAttrs: false })

/** As typed: the local number, or a full one until it reads as one. */
const number = defineModel<string>({ required: true })
const country = defineModel<PhoneCountry>('country', { required: true })
const props = defineProps<{ disabled?: boolean }>()

const countries = PHONE_COUNTRIES.map(c => ({ label: `${c.name} (${c.dialCode})`, value: c.code, icon: c.icon }))
const selected = computed(() => phoneCountryOf(country.value))
/** Its own id: the form field's id (its label's target) is the number's. */
const countryId = useId()

/**
 * The full number in what was typed, if it is one: `+…` or `00…`; or digits starting with a country
 * code (`85512345678`), only when they aren't a valid local number for the chosen country.
 */
function fullNumberIn(value: string) {
  const text = value.trim()
  if (/^(\+|00)/.test(text)) return parsePhone(text)
  const digits = text.replace(/\D/g, '')
  if (digits.length < 8 || parsePhone(text, country.value).ok) return undefined
  return parsePhone(`+${digits}`)
}

/** A full number names its country: take it, and keep the local part in the field. */
function onInput(value: string) {
  number.value = value
  const full = fullNumberIn(value)
  if (full?.ok) {
    country.value = full.country
    number.value = full.local
  }
}

/** On leaving: a valid local number without its trunk 0 or separators. */
function onBlur() {
  const result = parsePhone(number.value, country.value)
  if (result.ok && result.country === country.value) number.value = result.local
}
</script>

<template>
  <!-- The select sits in the input's leading slot (Nuxt UI's pattern): the input owns the form field's
       id, name and label; a control inside it gets none of them. -->
  <UInput
    v-bind="$attrs"
    :model-value="number"
    type="tel"
    inputmode="tel"
    autocomplete="tel-national"
    :disabled="props.disabled"
    class="w-full"
    :ui="{ leading: 'pointer-events-auto ps-0', base: 'ps-24' }"
    @update:model-value="value => onInput(String(value ?? ''))"
    @blur="onBlur"
  >
    <template #leading>
      <USelect
        :id="countryId"
        v-model="country"
        :items="countries"
        :disabled="props.disabled"
        variant="ghost"
        aria-label="Country code"
        :ui="{ content: 'min-w-56', trailingIcon: 'size-4' }"
        class="w-24 justify-between rounded-e-none"
      >
        <span class="flex items-center gap-1.5">
          <UIcon
            :name="selected.icon"
            class="size-4"
          />
          <span class="tabular-nums">{{ selected.dialCode }}</span>
        </span>
      </USelect>
    </template>
  </UInput>
</template>
