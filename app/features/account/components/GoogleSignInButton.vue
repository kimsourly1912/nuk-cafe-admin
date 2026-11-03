<script setup lang="ts">
defineProps<{ disabled: boolean }>()
defineEmits<{ click: [] }>()
const enabled = useRuntimeConfig().public.googleAuth.enabled
</script>

<template>
  <div
    v-if="enabled"
    class="space-y-4"
  >
    <UButton
      type="button"
      label="Continue with Google"
      color="neutral"
      variant="outline"
      block
      :disabled="disabled"
      @click="$emit('click')"
    >
      <template #leading>
        <img
          src="/google-g.png"
          alt=""
          width="200"
          height="204"
          class="size-5 object-contain"
        >
      </template>
    </UButton>
    <p class="text-sm text-muted">
      Already have an account? Use your email and password. For a Google account, use
      <ULink
        to="/forgot-password"
        class="text-primary"
      >
        Forgot password
      </ULink>
      to set a password before using account security or deleting your account.
    </p>
    <USeparator label="or use email" />
  </div>
</template>
