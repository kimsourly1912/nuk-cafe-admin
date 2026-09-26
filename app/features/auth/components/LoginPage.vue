<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import { loginRedirectTarget, useAuth } from '../composables/useAuth'

const schema = v.object({
  email: v.pipe(v.string(), v.trim(), v.minLength(1, 'Email is required'), v.email('Enter an email address')),
  password: v.pipe(v.string(), v.minLength(1, 'Password is required')),
})
type Schema = v.InferOutput<typeof schema>

const state = reactive({ email: '', password: '' })
const loading = ref(false)
// Hidden by default: staff sign in at the counter, where customers can see the screen.
const showPassword = ref(false)
const error = ref<string>()

const route = useRoute()
const { login } = useAuth()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = undefined
  try {
    await login(event.data)
    await navigateTo(loginRedirectTarget(route.query.redirect))
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
        label="Email"
        name="email"
        required
      >
        <UInput
          v-model="state.email"
          type="email"
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
          id="password"
          v-model="state.password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
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
              aria-controls="password"
              @click="showPassword = !showPassword"
            />
          </template>
        </UInput>
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
