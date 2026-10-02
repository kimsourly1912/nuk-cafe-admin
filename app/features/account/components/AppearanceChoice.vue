<script setup lang="ts">
/**
 * Light or Dark, in the account menu where the header has no room for the light/dark button (below
 * `lg`, D124). The same setting as Nuxt UI's `UColorModeButton`; no "System": the site is light
 * unless the person chooses dark (D96). Rendered only inside an open menu, so never on the server.
 */
const colorMode = useColorMode()
const choices = [
  { value: 'light', label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
] as const
</script>

<template>
  <div
    role="group"
    aria-labelledby="appearance-label"
  >
    <p
      id="appearance-label"
      class="px-2 pb-1 text-xs text-muted"
    >
      Appearance
    </p>
    <UButton
      v-for="choice in choices"
      :key="choice.value"
      :label="choice.label"
      :icon="choice.icon"
      :trailing-icon="colorMode.value === choice.value ? 'i-lucide-check' : undefined"
      :aria-pressed="colorMode.value === choice.value"
      color="neutral"
      variant="ghost"
      block
      class="justify-start"
      :ui="{ trailingIcon: 'ms-auto text-primary' }"
      @click="colorMode.preference = choice.value"
    />
  </div>
</template>
