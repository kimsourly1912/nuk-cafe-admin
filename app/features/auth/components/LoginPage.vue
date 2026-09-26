<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import { useAuth } from '../composables/useAuth'

const schema = v.object({
  username: v.pipe(v.string(), v.trim(), v.minLength(1, 'Username is required')),
  password: v.pipe(v.string(), v.minLength(1, 'Password is required')),
})
type Schema = v.InferOutput<typeof schema>

const state = reactive({ username: '', password: '' })
const loading = ref(false)
const error = ref<string>()

const route = useRoute()
const { login } = useAuth()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = undefined
  try {
    await login(event.data)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await navigateTo(redirect.startsWith('/') ? redirect : '/')
  }
  catch (e) {
    error.value = getErrorMessage(e)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-coffee"
          class="size-6 text-primary"
        />
        <h1 class="text-lg font-semibold">
          NUK Cafe Admin
        </h1>
      </div>
    </template>

    <UForm
      :schema="schema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
    >
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="error"
      />

      <UFormField
        label="Username"
        name="username"
        required
      >
        <UInput
          v-model="state.username"
          autocomplete="username"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Password"
        name="password"
        required
      >
        <UInput
          v-model="state.password"
          type="password"
          autocomplete="current-password"
          class="w-full"
        />
      </UFormField>

      <UButton
        type="submit"
        label="Sign in"
        block
        :loading="loading"
      />
    </UForm>
  </UCard>
</template>
