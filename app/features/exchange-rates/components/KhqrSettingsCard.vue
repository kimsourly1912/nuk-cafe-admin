<script setup lang="ts">
/**
 * Payments → KHQR (step 10.15, D130): the Bakong account that receives KHQR payments and what
 * customers see before they pay. Once on, the counter shows a QR for each order with its total and
 * number (Take payment → KHQR); the money goes straight to this account. Off, or not filled in, the
 * counter keeps using its printed KHQR. Saved from the version read: someone else's save meanwhile
 * shows Reload, which keeps what was typed.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { KhqrCurrency, KhqrSettings, KhqrSettingsInput } from '#shared/contracts/orders'
import { KHQR_ACCOUNT_MAX, KHQR_CITY_MAX, KHQR_NAME_MAX, khqrSettingsSchema } from '#shared/contracts/orders'
import { useKhqrSettings, useKhqrSettingsMutations } from '../composables/useExchangeRates'

const { data, error, loading, refresh } = useKhqrSettings()
const { save } = useKhqrSettingsMutations()

const empty = (): KhqrSettingsInput => ({ version: 0, enabled: true, accountId: '', merchantName: '', merchantCity: 'Phnom Penh', currencies: ['USD'] })
const fromSettings = (settings: KhqrSettings): KhqrSettingsInput => settings.version
  ? { version: settings.version, enabled: settings.enabled, accountId: settings.accountId ?? '', merchantName: settings.merchantName ?? '', merchantCity: settings.merchantCity ?? '', currencies: [...settings.currencies] }
  : empty()

const state = reactive<KhqrSettingsInput>(empty())
const saving = computed(() => save.pending)
const { markClean } = useUnsavedChanges(state, { paused: saving })

let loaded = false
watch(data, (settings) => {
  if (!settings || loaded) return
  loaded = true
  Object.assign(state, fromSettings(settings))
  markClean()
}, { immediate: true })

const conflict = ref(false)

/** Sends the checked values: the account lower-cased, the text trimmed, the currencies in order. */
async function submit(event: FormSubmitEvent<KhqrSettingsInput>) {
  conflict.value = false
  const result = await save.execute({ ...event.data, version: state.version })
  if (result.ok) {
    Object.assign(state, fromSettings(result.data))
    markClean()
  }
  else if (result.status === 'error' && result.error.code === 'VERSION_CONFLICT') {
    conflict.value = true
  }
}

/** Takes the latest version and keeps what was typed, so saving again applies it on top. */
async function reloadKeepingInput() {
  await refresh()
  if (data.value) state.version = data.value.version
  conflict.value = false
}

const currencyItems: { label: string, value: KhqrCurrency }[] = [
  { label: 'US dollars', value: 'USD' },
  { label: 'Riel (at the riel rate below, rounded up to ៛100)', value: 'KHR' },
]
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="khqr-settings"
  >
    <template #header>
      <h2
        id="khqr-settings"
        class="font-semibold text-highlighted"
      >
        KHQR at the counter
      </h2>
      <p class="text-sm text-muted">
        The counter shows a QR for each order with its total and number; customers scan it with any Cambodian banking app. The money goes straight to this Bakong account.
      </p>
    </template>

    <ApiErrorAlert
      v-if="error"
      :error="error"
      title="Could not load the KHQR settings"
      @retry="refresh()"
    />
    <USkeleton
      v-else-if="loading"
      class="h-48 w-full"
    />
    <UForm
      v-else
      id="khqr-form"
      :schema="khqrSettingsSchema"
      :state="state"
      :disabled="saving"
      class="space-y-4"
      @submit="submit"
    >
      <UAlert
        v-if="conflict"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Someone else saved the KHQR settings meanwhile."
        description="Reload to take their version; what you typed stays here, then save again."
        :actions="[{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reloadKeepingInput }]"
      />

      <USwitch
        v-model="state.enabled"
        label="Show a KHQR for each order at the counter"
        description="Off: the counter asks customers to scan its printed KHQR, as before."
      />

      <UFormField
        label="Bakong account ID"
        name="accountId"
        :help="`Where the money goes. It looks like name@bank; find it in your Bakong or banking app. At most ${KHQR_ACCOUNT_MAX} characters.`"
        required
      >
        <UInput
          v-model="state.accountId"
          placeholder="nukcafe@aclb"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          class="w-full"
        />
      </UFormField>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          label="Name customers see"
          name="merchantName"
          :help="`Shown in their banking app before they pay. Latin letters, at most ${KHQR_NAME_MAX}.`"
          required
        >
          <UInput
            v-model="state.merchantName"
            placeholder="NUK Cafe"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="City"
          name="merchantCity"
          :help="`At most ${KHQR_CITY_MAX} characters.`"
          required
        >
          <UInput
            v-model="state.merchantCity"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField
        label="Currencies"
        name="currencies"
        help="With both, the cashier chooses for each order."
        required
      >
        <UCheckboxGroup
          v-model="state.currencies"
          :items="currencyItems"
        />
      </UFormField>

      <UButton
        type="submit"
        label="Save KHQR settings"
        :loading="saving"
      />
    </UForm>
  </UCard>
</template>
