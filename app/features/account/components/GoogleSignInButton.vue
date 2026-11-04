<script setup lang="ts">
defineProps<{ enabled: boolean, disabled: boolean }>()
defineEmits<{ click: [] }>()
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
      Google-only account? Use
      <ULink
        to="/forgot-password"
        class="text-primary"
      >
        Forgot password
      </ULink>
      to set a password for account security or deletion.
    </p>
    <USeparator label="or use email" />
  </div>
</template>
