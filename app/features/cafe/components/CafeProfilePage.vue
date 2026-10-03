<script setup lang="ts">
/**
 * Cafe profile (`/admin/cafe`, D143; page-patterns §3, the settings blueprint): the cafe's name and
 * logo, shown on its menu, the counter, this admin and the account pages. One draft, one **Save
 * changes**: in the navbar from `lg`, in the bottom bar below it, while the draft has changes.
 * Leaving with changes asks first. Someone else's save (409) keeps the input and offers Reload. The
 * web address is read-only: the platform team changes it (D142), since printed QR codes and links
 * carry it.
 */
import type { CafeSettings } from '#shared/contracts/cafe'
import { CAFE_NAME_MAX } from '#shared/contracts/cafe'
import { fetchCafeSettings, useCafeMutations, useCafeSettings } from '../composables/useCafeSettings'
import type { CafeForm } from '../schemas/cafe-form'
import { cafeFormSchema, toCafeForm, toUpdateCafeBody } from '../schemas/cafe-form'

const { data, error, refresh } = useCafeSettings()
const { save } = useCafeMutations()

/** The saved profile this draft is based on (its version is what Save names). */
const saved = shallowRef<CafeSettings>()
const state = reactive<CafeForm>({ name: '' })
const saving = ref(false)
const uploading = ref(false)
const unsaved = useUnsavedChanges(state, { paused: saving })
const form = useTemplateRef('form')

// The draft starts from the first load only: a refresh (another tab saved) never replaces input.
watch(data, (settings) => {
  if (!settings || saved.value) return
  saved.value = settings
  Object.assign(state, toCafeForm(settings))
  unsaved.markClean()
}, { immediate: true })

const conflict = ref(false)
const lastError = ref<string>()

async function submit() {
  await form.value?.submit()
}

async function onSubmit() {
  if (saving.value || uploading.value || !saved.value) return
  saving.value = true
  lastError.value = undefined
  conflict.value = false
  const result = await save.execute(toUpdateCafeBody(state, saved.value.version))
  saving.value = false
  if (result.ok) {
    saved.value = result.data
    Object.assign(state, toCafeForm(result.data))
    unsaved.markClean()
    return
  }
  if (result.status !== 'error') return
  if (result.error.code === 'VERSION_CONFLICT') {
    conflict.value = true
    return
  }
  const fieldErrors = Object.entries(result.error.fieldErrors ?? {})
    .flatMap(([field, messages]) => (messages[0] ? [{ name: field === 'logoAssetId' ? 'logoId' : field, message: messages[0] }] : []))
  form.value?.setErrors(fieldErrors)
  if (!fieldErrors.length) lastError.value = result.error.message
}

/** Someone else saved: take their version, keep this input, save again to overwrite. */
async function reload() {
  const latest = await fetchCafeSettings().catch(() => undefined)
  if (!latest) return
  saved.value = latest
  conflict.value = false
}

useSubmitShortcut(submit)

const tenantPath = useTenantPath()
const origin = useRequestURL().origin
const address = computed(() => (saved.value ? `${origin}${tenantUrl(saved.value.slug, '/')}` : ''))
</script>

<template>
  <UDashboardPanel
    id="cafe-profile"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar title="Cafe profile">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            v-if="saved"
            text="Save changes"
            :kbds="['meta', 'enter']"
          >
            <UButton
              label="Save changes"
              icon="i-lucide-save"
              class="hidden lg:inline-flex"
              :disabled="!unsaved.isDirty.value || uploading"
              :loading="saving"
              @click="submit()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error && !saved"
        :error="error"
        title="Could not load the cafe profile"
        @retry="refresh()"
      />
      <ListSkeleton
        v-else-if="!saved"
        label="Loading the cafe profile…"
        variant="card"
      />
      <div
        v-else
        class="space-y-6"
      >
        <div>
          <h2 class="text-lg font-semibold text-highlighted">
            Cafe profile
          </h2>
          <p class="text-sm text-muted">
            How customers and staff see your cafe: on the menu, the counter and this admin.
          </p>
        </div>

        <UAlert
          v-if="conflict"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Someone else changed the cafe profile"
          description="Reload to base your changes on theirs (your input stays), then save again."
          :actions="[{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }]"
        />
        <UAlert
          v-if="lastError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Not saved"
          :description="lastError"
        />

        <UForm
          id="cafe-profile-form"
          ref="form"
          :schema="cafeFormSchema"
          :state="state"
          :validate-on="['input', 'change']"
          :disabled="saving"
          class="space-y-6"
          @submit="onSubmit"
        >
          <UCard variant="outline">
            <section
              aria-labelledby="cafe-identity"
              class="space-y-4"
            >
              <div>
                <h3
                  id="cafe-identity"
                  class="font-semibold text-highlighted"
                >
                  Name and logo
                </h3>
                <p class="text-sm text-muted">
                  Shown at the top of the menu, beside the order number on the counter and in this sidebar.
                </p>
              </div>
              <UFormField
                label="Cafe name"
                name="name"
                :help="`At most ${CAFE_NAME_MAX} characters.`"
                required
              >
                <UInput
                  v-model="state.name"
                  autocomplete="organization"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Logo"
                name="logoId"
                help="A square image works best: it's shown small, beside the name. Without one, a coffee cup is shown."
              >
                <ImageInput
                  v-model:image-url="state.logoUrl"
                  v-model:image-id="state.logoId"
                  v-model:uploading="uploading"
                  alt="Cafe logo"
                  noun="logo"
                  :disabled="saving"
                />
              </UFormField>
              <div class="flex items-center gap-2 rounded-lg border border-default bg-elevated/50 p-3">
                <span class="text-sm text-muted">Preview:</span>
                <CafeLogo
                  :url="state.logoUrl"
                  class="size-6"
                />
                <span class="truncate font-semibold text-highlighted">{{ state.name.trim() || 'Cafe name' }}</span>
              </div>
            </section>
          </UCard>
        </UForm>

        <UCard variant="outline">
          <section
            aria-labelledby="cafe-address"
            class="space-y-2"
          >
            <h3
              id="cafe-address"
              class="font-semibold text-highlighted"
            >
              Web address
            </h3>
            <p class="text-sm">
              <ULink
                :to="tenantPath('/')"
                class="font-medium text-primary underline"
              >
                {{ address }}
              </ULink>
            </p>
            <p class="text-sm text-muted">
              Your menu's address; the admin and the counter are under it, and your table QR codes open it. Only the platform team can change it.
            </p>
          </section>
        </UCard>
      </div>

      <BottomActionBar
        label="Save"
        :open="unsaved.isDirty.value || saving"
        expanded="hidden"
      >
        <p class="min-w-0 flex-1 text-sm text-muted">
          Unsaved changes
        </p>
        <UButton
          type="submit"
          form="cafe-profile-form"
          label="Save changes"
          icon="i-lucide-save"
          :loading="saving"
          :disabled="uploading"
        />
      </BottomActionBar>
    </template>
  </UDashboardPanel>
</template>
