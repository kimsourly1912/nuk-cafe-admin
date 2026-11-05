<script setup lang="ts">
/** The form's error above its fields; focusable, so a failure moves focus here (page-patterns §5). */
import { FORM_ERROR_ID } from '../composables/useAccountForm'

defineProps<{ message?: string }>()
</script>

<template>
  <!-- Leave only (D264): the alert itself eases in (app.config `alert`); fixed, it eases out. -->
  <Transition name="alert">
    <div
      v-if="message"
      :id="FORM_ERROR_ID"
      role="alert"
      tabindex="-1"
      class="outline-none"
    >
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="message"
      />
    </div>
  </Transition>
</template>
