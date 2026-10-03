<script setup lang="ts">
/**
 * A new cafe's result (D142): where it lives and how its owner gets in. The owner's temporary
 * password is shown once: it isn't stored anywhere it can be read again, and they choose their own
 * at their first sign-in. An owner who already had an account signs in with their own password.
 */
import { useClipboard } from '@vueuse/core'
import type { CreatedTenant } from '#shared/contracts/tenants'

const props = defineProps<{ created: CreatedTenant }>()
const emit = defineEmits<{ close: [] }>()

const cafe = computed(() => props.created.tenant)
const owner = computed(() => cafe.value.owners[0])
const origin = import.meta.client ? window.location.origin : ''
const adminUrl = computed(() => `${origin}${tenantUrl(cafe.value.slug, '/admin/login')}`)

const password = useClipboard({ source: () => props.created.temporaryPassword ?? '', copiedDuring: 2000 })
const link = useClipboard({ source: () => adminUrl.value, copiedDuring: 2000 })

async function openCafe() {
  emit('close')
  await navigateTo(`/platform/cafes/${cafe.value.id}`)
}
</script>

<template>
  <UModal
    :title="`${cafe.name} is ready`"
    :dismissible="false"
    :close="false"
  >
    <template #body>
      <div class="space-y-4 text-sm">
        <p>
          Its menu is at
          <a
            :href="tenantUrl(cafe.slug, '/')"
            target="_blank"
            class="font-medium text-primary underline"
          >/c/{{ cafe.slug }}</a>,
          empty until the owner adds items.
        </p>

        <div class="space-y-1">
          <p class="font-medium text-highlighted">
            The owner signs in at
          </p>
          <div class="flex items-center gap-2">
            <code class="min-w-0 flex-1 truncate rounded-md bg-elevated px-3 py-2">{{ adminUrl }}</code>
            <UButton
              v-if="link.isSupported.value"
              :icon="link.copied.value ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="link.copied.value ? 'Copied' : 'Copy'"
              color="neutral"
              variant="outline"
              @click="link.copy()"
            />
          </div>
        </div>

        <template v-if="created.temporaryPassword">
          <p>
            Give this temporary password to <span class="font-medium">{{ owner?.name }}</span> ({{ owner?.email }}).
            They choose their own at their first sign-in.
          </p>
          <div class="flex items-center gap-2">
            <code
              class="flex-1 rounded-md bg-elevated px-3 py-2 text-center font-mono text-lg tracking-wider"
              data-testid="temporary-password"
            >{{ created.temporaryPassword }}</code>
            <UButton
              v-if="password.isSupported.value"
              :icon="password.copied.value ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="password.copied.value ? 'Copied' : 'Copy'"
              color="neutral"
              variant="outline"
              @click="password.copy()"
            />
          </div>
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="It won't be shown again"
            description="Hand it over in person or through a private channel."
          />
        </template>
        <p v-else>
          <span class="font-medium">{{ owner?.name }}</span> ({{ owner?.email }}) already had an account:
          they sign in with their own password.
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Open cafe"
          color="neutral"
          variant="outline"
          @click="openCafe()"
        />
        <UButton
          label="Done"
          @click="emit('close')"
        />
      </div>
    </template>
  </UModal>
</template>
