<script setup lang="ts">
/** A password field with a show/hide button inside it (the admin's sign-in does the same). */
defineProps<{ id: string, autocomplete: 'current-password' | 'new-password' }>()
const model = defineModel<string>({ required: true })
const visible = ref(false)
</script>

<template>
  <UInput
    :id="id"
    v-model="model"
    :type="visible ? 'text' : 'password'"
    :autocomplete="autocomplete"
    class="w-full"
    :ui="{ trailing: 'pe-1' }"
  >
    <template #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        :icon="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="visible ? 'Hide password' : 'Show password'"
        :aria-pressed="visible"
        :aria-controls="id"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
