<script setup lang="ts">
/**
 * Payments → KHQR (step 10.15, D130): the Bakong account that receives KHQR payments and what
 * customers see before they pay. Once on, the counter shows a QR for each order with its total and
 * number (Take payment → KHQR); the money goes straight to this account. Off, or not filled in, the
 * counter keeps using its printed KHQR. Saved from the version read: someone else's save meanwhile
 * shows Reload, which keeps what was typed.
 *
 * The automatic check (10.15b, D131): with the cafe's own Bakong token saved here (T2d, D148: stored
 * encrypted, never shown again; Replace and Remove at the version read), the counter records a QR's
 * payment as soon as Bakong confirms it. Test connection asks Bakong once, so a refused token or
 * server shows here rather than at the counter. The token's expiry (read from it on the server,
 * 10.16, D132) shows here too, amber within 14 days and red once expired; Telegram reminds the
 * chats that get server errors and reminders.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { BakongConnectionTest, KhqrCheckProblem, KhqrCurrency, KhqrSettings, KhqrSettingsInput } from '#shared/contracts/orders'
import { KHQR_ACCOUNT_MAX, KHQR_CITY_MAX, KHQR_NAME_MAX, khqrSettingsSchema } from '#shared/contracts/orders'
import { testBakongConnection, useKhqrSettings, useKhqrSettingsMutations } from '../composables/useExchangeRates'
import { tokenExpiry } from '../utils/bakong-token'
import BakongTokenModal from './BakongTokenModal.vue'

const { data, error, loading, refresh } = useKhqrSettings()
const { save, removeToken } = useKhqrSettingsMutations()
const { name: cafeName } = useCafe()

const empty = (): KhqrSettingsInput => ({ version: 0, enabled: true, accountId: '', merchantName: '', merchantCity: 'Phnom Penh', currencies: ['USD'] })
const fromSettings = (settings: KhqrSettings): KhqrSettingsInput => settings.version
  ? { version: settings.version, enabled: settings.enabled, accountId: settings.accountId ?? '', merchantName: settings.merchantName ?? '', merchantCity: settings.merchantCity ?? '', currencies: [...settings.currencies] }
  : empty()

const state = reactive<KhqrSettingsInput>(empty())
const form = useTemplateRef('form')
useFormErrorRecheck(form)
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
  not_set_up: 'This cafe has no Bakong token.',
  token: 'Bakong didn\'t accept the token. Tokens last 90 days: get a new one in Bakong\'s developer portal and replace it here.',
  key: 'The saved token can\'t be read on this server any more. Replace it with the token from Bakong\'s developer portal.',
  refused: 'Bakong refused this server. Bakong may answer only servers in Cambodia; until then, cashiers confirm KHQR payments by hand.',
  error: 'Bakong didn\'t answer. Try again in a minute.',
}

const expiry = computed(() => (data.value?.token?.expiresAt ? tokenExpiry(data.value.token.expiresAt, Date.now()) : null))
const setOn = computed(() => data.value?.token && new Date(data.value.token.setAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))

// --- The cafe's token (T2d, D148) ---
const tokenModal = useOverlay().create(BakongTokenModal)
async function openTokenModal() {
  const saved = await tokenModal.open({ version: data.value?.token?.version ?? 0 })
  if (saved) testResult.value = null
}
async function remove() {
  if (!data.value?.token) return
  const result = await removeToken.execute({ version: data.value.token.version })
  if (result.ok) testResult.value = null
}
const expiryColor = { neutral: 'neutral', warning: 'warning', error: 'error' } as const

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
      ref="form"
      :schema="khqrSettingsSchema"
      :state="state"
      :disabled="saving"
      class="space-y-4"
      @submit="submit"
      @error="focusFirstInvalid"
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
            :placeholder="cafeName"
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
            : 'Cashiers confirm each KHQR payment after it appears in the bank app. Add your Bakong token to check payments automatically.' }}
        </p>
        <UAlert
          v-if="!data.tokenStorage"
          color="neutral"
          variant="subtle"
          icon="i-lucide-lock"
          title="Tokens can't be saved on this server yet"
          description="The platform team sets up its encryption key first. Until then, cashiers confirm KHQR payments by hand."
        />
        <template v-if="data.token">
          <UAlert
            v-if="expiry"
            :color="expiryColor[expiry.tone]"
            variant="subtle"
            :icon="expiry.tone === 'neutral' ? 'i-lucide-key-round' : 'i-lucide-triangle-alert'"
            :title="expiry.title"
            :description="expiry.tone === 'neutral'
              ? 'Bakong tokens last 90 days. Telegram reminds the chats that get server errors and reminders 14, 7, 3 and 1 days before.'
              : expiry.tone === 'warning'
                ? 'Get a new token from Bakong\'s developer portal and replace it here before then, or cashiers will have to confirm KHQR payments by hand.'
                : 'Cashiers confirm KHQR payments by hand until a new token is saved: get one from Bakong\'s developer portal and replace it here.'"
          />
          <p
            v-else
            class="text-sm text-muted"
          >
            This token carries no expiry date: Bakong tokens last 90 days, so note the day you set it.
          </p>
          <p class="text-sm text-muted">
            Token saved {{ setOn }} by {{ data.token.setBy.name }}. It's stored encrypted and isn't shown again.
          </p>
        </template>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="data.tokenStorage"
            :label="data.token ? 'Replace token' : 'Add token'"
            :icon="data.token ? 'i-lucide-refresh-cw' : 'i-lucide-key-round'"
            :color="data.token ? 'neutral' : 'primary'"
            :variant="data.token ? 'outline' : 'solid'"
            :disabled="removeToken.pending"
            @click="openTokenModal"
          />
          <UButton
            v-if="data.automaticCheck"
            label="Test connection"
            icon="i-lucide-plug-zap"
            color="neutral"
            variant="outline"
            :loading="testing"
            @click="runTest"
          />
          <UButton
            v-if="data.token"
            label="Remove token"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            :loading="removeToken.pending"
            @click="remove"
          />
        </div>
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
