<script setup lang="ts">
/**
 * A phone number (D127): the country (a flag, a fixed set: searchable `USelectMenu`) beside the
 * number, whose dial code leads the input, as one field group. People type or paste anything; the form's schema decides what's valid
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

const input = useTemplateRef<{ inputRef: HTMLInputElement | null }>('input')
const countries = PHONE_COUNTRIES.map(c => ({ label: `${c.name} (${c.dialCode})`, value: c.code, icon: c.icon }))
const selected = computed(() => phoneCountryOf(country.value))

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

function syncField() {
  const el = input.value?.inputRef
  if (el) el.value = number.value
}

/** A full number names its country: take it, and keep the local part in the field. */
function onInput(raw: string) {
  // Digits only, plus what a pasted number carries: a leading +, and spaces, dashes, dots and brackets.
  const value = raw.replace(/[^\d+\s\-.()]/g, '').replace(/(?!^)\+/g, '')
  number.value = value
  // A rejected key leaves the model as it was: the field must still drop it.
  if (value !== raw) void nextTick(syncField)
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
  <!-- The country menu and the number sit in one field group; the input owns the form field's id, name and
       label (`PhoneInputCountry` keeps the menu out of the field). The dial code is the input's leading text. -->
  <UFieldGroup class="w-full">
    <PhoneInputCountry
      v-model="country"
      :items="countries"
      :icon="selected.icon"
      :disabled="props.disabled"
    />

    <UInput
      ref="input"
      v-bind="$attrs"
      :model-value="number"
      type="tel"
      inputmode="tel"
      autocomplete="tel-national"
      :disabled="props.disabled"
      class="flex-1"
      :style="{ '--dial-code-length': `calc(${selected.dialCode.length}ch + 1.25rem)` }"
      :ui="{ base: 'ps-(--dial-code-length)', leading: 'pointer-events-none text-base md:text-sm text-muted' }"
      @update:model-value="value => onInput(String(value ?? ''))"
      @blur="onBlur"
    >
      <template #leading>
        <span class="tabular-nums">{{ selected.dialCode }}</span>
      </template>
    </UInput>
  </UFieldGroup>
</template>
