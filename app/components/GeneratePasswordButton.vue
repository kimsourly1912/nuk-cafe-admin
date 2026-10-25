<script setup lang="ts">
/**
 * The Generate button inside a new-password field (D210): makes a strong random password and hands
 * it to the page, which fills the field (and its repeat) and shows it. Screen readers hear that it
 * was filled in, since nothing else moves.
 *
 * Pressing it keeps the focus in the field: a blur would re-check the field first, and when that
 * clears an error line the centered card shrinks and moves the button away before the click lands.
 */
import { generatePassword } from '~/utils/password-requirements'

const emit = defineEmits<{ generate: [password: string] }>()
const announcement = ref('')

async function generate() {
  emit('generate', generatePassword())
  announcement.value = ''
  await nextTick()
  announcement.value = 'A strong password was filled in. Save it in your password manager or write it down.'
}
</script>

<template>
  <UTooltip text="Generate a strong password">
    <UButton
      color="neutral"
      variant="link"
      size="sm"
      icon="i-lucide-wand-sparkles"
      aria-label="Generate a strong password"
      @mousedown.prevent
      @click="generate"
    />
  </UTooltip>
  <span
    role="status"
    class="sr-only"
  >{{ announcement }}</span>
</template>
