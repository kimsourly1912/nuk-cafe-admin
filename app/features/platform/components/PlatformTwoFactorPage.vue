<script setup lang="ts">
/**
 * Set up two-step sign-in (`/platform/two-factor`, P1b, D188): required before any other console
 * page (the route middleware sends every page here until it's on). The password first; then the QR
 * code for an authenticator app (or its key typed in), the backup codes, shown once, and a code from
 * the app to prove it was added. Turning it on signs the account out on its other devices.
 */
import { useClipboard } from '@vueuse/core'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import { platformRedirectTarget, usePlatformSession } from '../composables/usePlatformSession'

const route = useRoute()
const toast = useToast()
const { user, startTwoFactor, confirmTwoFactor, signOut } = usePlatformSession()

const setup = ref<{ totpURI: string, backupCodes: string[] }>()
const saving = ref(false)
const error = ref<string>()
const showPassword = ref(false)
const passwordState = reactive({ password: '' })
const passwordSchema = v.object({ password: v.pipe(v.string(), v.minLength(1, 'Password is required')) })

const errorAlert = useTemplateRef<HTMLElement>('errorAlert')
const passwordForm = useTemplateRef('passwordForm')
useFormErrorRecheck(passwordForm)

/** The key to type into the app when the QR code can't be scanned, in groups of four. */
const key = computed(() => (setup.value ? new URL(setup.value.totpURI).searchParams.get('secret') ?? '' : '').replace(/(.{4})/g, '$1 ').trim())
const backupText = computed(() => setup.value?.backupCodes.join('\n') ?? '')
const copyKey = useClipboard({ source: () => key.value.replace(/\s/g, ''), copiedDuring: 2000 })
const copyCodes = useClipboard({ source: backupText, copiedDuring: 2000 })

function downloadCodes() {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([`NUK Platform backup codes for ${user.value?.email ?? ''}\nEach code works once.\n\n${backupText.value}\n`], { type: 'text/plain' }))
  link.download = 'nuk-platform-backup-codes.txt'
  link.click()
  URL.revokeObjectURL(link.href)
}

async function showError(e: unknown) {
  error.value = getErrorMessage(e)
  await nextTick()
  errorAlert.value?.focus()
}

async function onPassword({ data }: FormSubmitEvent<v.InferOutput<typeof passwordSchema>>) {
  saving.value = true
  error.value = undefined
  try {
    setup.value = await startTwoFactor(data.password)
    passwordState.password = ''
  }
  catch (e) {
    await showError(e)
  }
  finally {
    saving.value = false
  }
}

async function onCode({ data }: FormSubmitEvent<{ code: string }>) {
  if (saving.value || !savedCodes.value) return
  saving.value = true
  error.value = undefined
  try {
    await confirmTwoFactor(data.code)
  }
  catch (e) {
    saving.value = false
    // Beside the field, with the cells emptied and the first one focused: retyping is one motion.
    codeState.code = ''
    codeForm.value?.setErrors([{ name: 'code', message: getErrorMessage(e) }])
    await nextTick()
    pinCells.value?.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus()
    return
  }
  toast.add({ title: 'Two-step sign-in is on', description: 'You were signed out on your other devices.', color: 'success', icon: 'i-lucide-circle-check' })
  try {
    await navigateTo(platformRedirectTarget(route.query.redirect))
  }
  finally {
    saving.value = false
  }
}

const codeState = reactive({ code: '' })
// A number-type UPinInput models an array of digit numbers; the schema takes the joined string.
const pin = computed<number[]>({
  get: () => codeState.code.split('').map(Number),
  set: (digits) => { codeState.code = digits.join('') },
})
const codeSchema = v.object({ code: v.pipe(v.string(), v.trim(), v.regex(/^\d{6}$/, 'Enter the 6 digits from your app')) })
const codeForm = useTemplateRef('codeForm')
useFormErrorRecheck(codeForm)
const pinCells = useTemplateRef<HTMLElement>('pinCells')
/** The backup codes are shown once: turning it on waits until they are saved. */
const savedCodes = ref(false)
</script>

<template>
  <TaskFrame :wide="!!setup">
    <template #header>
      <div class="flex items-center gap-3">
        <UIcon
          name="i-lucide-shield-check"
          class="size-6 shrink-0 text-primary"
        />
        <div class="min-w-0">
          <h1 class="text-lg font-semibold">
            Set up two-step sign-in
          </h1>
          <p
            v-if="setup"
            class="text-sm text-muted"
          >
            Protect your console with an authenticator app.
          </p>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <p
        v-if="!setup"
        class="text-sm text-muted"
      >
        The platform console needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) as well as your password, so a stolen password alone can't open it.
      </p>

      <div
        v-if="error"
        ref="errorAlert"
        role="alert"
        tabindex="-1"
      >
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
        />
      </div>

      <UForm
        v-if="!setup"
        id="two-factor-password"
        ref="passwordForm"
        :schema="passwordSchema"
        :state="passwordState"
        :disabled="saving"
        :validate-on="['input', 'change']"
        class="space-y-4"
        @submit="onPassword"
        @error="focusFirstInvalid"
      >
        <UFormField
          label="Your password"
          name="password"
          required
        >
          <UInput
            id="two-factor-password-input"
            v-model="passwordState.password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            autofocus
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                :aria-pressed="showPassword"
                aria-controls="two-factor-password-input"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </UFormField>
      </UForm>

      <template v-else>
        <div class="grid gap-6 md:grid-cols-2 md:gap-8">
          <section class="space-y-3 md:flex md:flex-col">
            <div class="flex items-start gap-3">
              <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-medium">1</span>
              <div>
                <h2 class="font-medium text-highlighted">
                  Add your authenticator
                </h2>
                <p class="text-sm text-muted">
                  Scan this QR code with your authenticator app.
                </p>
              </div>
            </div>
            <div class="flex flex-col items-center gap-3 md:flex-1 md:justify-center">
              <QrCode
                :value="setup.totpURI"
                label="QR code for your authenticator app"
                class="size-40 shrink-0"
              />
              <UCollapsible class="w-full">
                <UButton
                  label="Can't scan? Use a setup key"
                  trailing-icon="i-lucide-chevron-down"
                  color="neutral"
                  variant="link"
                  size="sm"
                  class="mx-auto flex"
                />
                <template #content>
                  <div class="flex items-center gap-2 pt-2">
                    <code
                      class="min-w-0 flex-1 break-all rounded-md bg-elevated px-2 py-1 font-mono text-sm"
                      data-testid="two-factor-key"
                    >{{ key }}</code>
                    <UButton
                      v-if="copyKey.isSupported.value"
                      :icon="copyKey.copied.value ? 'i-lucide-check' : 'i-lucide-copy'"
                      :aria-label="copyKey.copied.value ? 'Key copied' : 'Copy key'"
                      color="neutral"
                      variant="outline"
                      size="sm"
                      @click="copyKey.copy()"
                    />
                  </div>
                </template>
              </UCollapsible>
              <p class="max-w-64 text-balance text-center text-xs text-muted">
                Works with Google Authenticator, Microsoft Authenticator and 1Password.
              </p>
            </div>
          </section>

          <section class="space-y-3 border-default max-md:border-t max-md:pt-6 md:border-s md:ps-8">
            <div class="flex items-start gap-3">
              <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-medium">2</span>
              <div>
                <h2 class="font-medium text-highlighted">
                  Save your backup codes
                </h2>
                <p class="text-sm text-muted">
                  If you lose your phone, each code signs you in once. They won't be shown again.
                </p>
              </div>
            </div>
            <div class="space-y-3 rounded-md bg-elevated p-3">
              <ul
                class="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-sm"
                aria-label="Backup codes"
                data-testid="backup-codes"
              >
                <li
                  v-for="code in setup.backupCodes"
                  :key="code"
                >
                  {{ code }}
                </li>
              </ul>
              <div class="flex gap-2">
                <UButton
                  v-if="copyCodes.isSupported.value"
                  :icon="copyCodes.copied.value ? 'i-lucide-check' : 'i-lucide-copy'"
                  :label="copyCodes.copied.value ? 'Copied' : 'Copy codes'"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  class="flex-1 justify-center"
                  @click="copyCodes.copy()"
                />
                <UButton
                  icon="i-lucide-download"
                  label="Download"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  class="flex-1 justify-center"
                  @click="downloadCodes()"
                />
              </div>
              <UCheckbox
                v-model="savedCodes"
                label="I've saved my backup codes"
                :description="savedCodes ? undefined : 'Tick this to turn on two-step sign-in.'"
                class="border-t border-default pt-3"
                :ui="{ description: 'text-toned' }"
              />
            </div>
          </section>
        </div>

        <section class="space-y-3 border-t border-default pt-6">
          <div class="flex items-start gap-3">
            <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-medium">3</span>
            <div>
              <h2 class="font-medium text-highlighted">
                Verify your app
              </h2>
              <p class="text-sm text-muted">
                Enter the 6-digit code from your app.
              </p>
            </div>
          </div>
          <UForm
            id="two-factor-code"
            ref="codeForm"
            :schema="codeSchema"
            :state="codeState"
            :validate-on="['input', 'change']"
            :disabled="saving"
            @submit="onCode"
            @error="focusFirstInvalid"
          >
            <UFormField
              label="Authentication code"
              name="code"
              help="The code changes every 30 seconds."
              required
              :ui="{ root: 'flex flex-col items-center text-center' }"
            >
              <div ref="pinCells">
                <UPinInput
                  v-model="pin"
                  :length="6"
                  type="number"
                  size="lg"
                  otp
                />
              </div>
            </UFormField>
          </UForm>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <p
          v-if="setup"
          class="mb-1 flex items-center justify-center gap-1.5 text-xs text-muted"
        >
          <UIcon
            name="i-lucide-info"
            class="size-4 shrink-0"
          />
          Turning this on signs you out on your other devices.
        </p>
        <UButton
          type="submit"
          :form="setup ? 'two-factor-code' : 'two-factor-password'"
          :label="setup ? 'Turn on two-step sign-in' : 'Continue'"
          block
          :loading="saving"
          :disabled="!!setup && !savedCodes"
        />
        <UButton
          label="Log out"
          color="neutral"
          variant="ghost"
          block
          :disabled="saving"
          @click="signOut()"
        />
      </div>
    </template>
  </TaskFrame>
</template>
