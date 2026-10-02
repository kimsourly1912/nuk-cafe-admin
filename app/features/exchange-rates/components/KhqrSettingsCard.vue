<script setup lang="ts">
/**
 * Payments → KHQR (step 10.15, D130): the Bakong account that receives KHQR payments and what
 * customers see before they pay. Once on, the counter shows a QR for each order with its total and
 * number (Take payment → KHQR); the money goes straight to this account. Off, or not filled in, the
 * counter keeps using its printed KHQR. Saved from the version read: someone else's save meanwhile
 * shows Reload, which keeps what was typed.
 *
 * The automatic check (10.15b, D131): with the `NUXT_BAKONG_TOKEN` secret set, the counter records
 * a QR's payment as soon as Bakong confirms it. Test connection asks Bakong once, so a refused
 * token or server shows here rather than at the counter.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { BakongConnectionTest, KhqrCheckProblem, KhqrCurrency, KhqrSettings, KhqrSettingsInput } from '#shared/contracts/orders'
import { KHQR_ACCOUNT_MAX, KHQR_CITY_MAX, KHQR_NAME_MAX, khqrSettingsSchema } from '#shared/contracts/orders'
import { testBakongConnection, useKhqrSettings, useKhqrSettingsMutations } from '../composables/useExchangeRates'

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

// --- Test connection ---
const notify = useNotify()
const testing = ref(false)
const testResult = ref<BakongConnectionTest | null>(null)
async function runTest() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await testBakongConnection()
  }
  catch (error) {
    notify.error('Couldn\'t test the connection', error)
  }
  finally {
    testing.value = false
  }
}
const problemText: Record<KhqrCheckProblem, string> = {
  not_set_up: 'This server has no Bakong token.',
  token: 'Bakong didn\'t accept the token. Tokens last 90 days: get a new one in Bakong\'s developer portal and replace the NUXT_BAKONG_TOKEN secret.',
  refused: 'Bakong refused this server. Bakong may answer only servers in Cambodia; until then, cashiers confirm KHQR payments by hand.',
  error: 'Bakong didn\'t answer. Try again in a minute.',
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

    <template
      v-if="data"
      #footer
    >
      <section
        aria-labelledby="khqr-automatic-check"
        class="space-y-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <h3
            id="khqr-automatic-check"
            class="text-sm font-semibold text-highlighted"
          >
            Automatic check with Bakong
          </h3>
          <UBadge
            :label="data.automaticCheck ? 'On' : 'Off'"
            :color="data.automaticCheck ? 'success' : 'neutral'"
            variant="subtle"
          />
        </div>
        <p class="text-sm text-muted">
          {{ data.automaticCheck
            ? 'The counter records a KHQR payment as soon as Bakong confirms it; cashiers can still confirm by hand.'
            : 'Cashiers confirm each KHQR payment after it appears in the bank app. To check automatically, the owner sets the Bakong token as the server secret NUXT_BAKONG_TOKEN.' }}
        </p>
        <UButton
          v-if="data.automaticCheck"
          label="Test connection"
          icon="i-lucide-plug-zap"
          color="neutral"
          variant="outline"
          :loading="testing"
          @click="runTest"
        />
        <UAlert
          v-if="testResult?.status === 'connected'"
          color="success"
          variant="subtle"
          icon="i-lucide-circle-check"
          title="Connected: Bakong answered this server."
        />
        <UAlert
          v-else-if="testResult?.status === 'unavailable'"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="problemText[testResult.problem]"
          :description="testResult.detail ?? undefined"
        />
      </section>
    </template>
  </UCard>
</template>
