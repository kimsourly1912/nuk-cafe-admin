<script setup lang="ts">
import type { NuxtError } from '#app'
import { isAdminPath } from '~/features/auth'

/** Fatal errors: unknown routes, or `showError()` / `throw createError({ fatal: true })`. */
const props = defineProps<{ error: NuxtError }>()

const isNotFound = computed(() => props.error.statusCode === 404)
// The admin workspace goes back to its dashboard, the customer site to the menu (D93).
const inAdmin = isAdminPath(useRoute().path)
const home = inAdmin ? { label: 'Back to dashboard', path: '/admin' } : { label: 'Back to the menu', path: '/' }
const title = computed(() => (isNotFound.value ? 'Page not found' : 'Something went wrong'))
// Rendered instead of app.vue, so it sets its own tab title.
useHead({ title: () => `${title.value} · ${inAdmin ? 'NUK Cafe Admin' : 'NUK Cafe'}` })
const description = computed(() => (isNotFound.value
  ? 'The page you are looking for doesn\'t exist.'
  : getErrorMessage(props.error)))
</script>

<template>
  <UApp>
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
      <UIcon
        :name="isNotFound ? 'i-lucide-map-pin-off' : 'i-lucide-triangle-alert'"
        class="size-10 text-muted"
      />
      <h1 class="text-xl font-semibold">
        {{ title }}
      </h1>
      <p class="max-w-md text-muted">
        {{ description }}
      </p>
      <UButton
        :label="home.label"
        icon="i-lucide-arrow-left"
        @click="clearError({ redirect: home.path })"
      />
    </div>
  </UApp>
</template>
