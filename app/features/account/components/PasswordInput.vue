<script setup lang="ts">
/**
 * A password field with a show/hide button inside it (the admin's sign-in does the same). A new
 * password also gets the Generate button (D210): it fills the field, shows what it made and emits
 * it, so the page's checklist can skip checking it.
 */
import { fillInput } from '~/utils/password-requirements'

const props = defineProps<{ id: string, autocomplete: 'current-password' | 'new-password' }>()
const model = defineModel<string>({ required: true })
const visible = ref(false)
const emit = defineEmits<{ generate: [password: string] }>()

function fillGenerated(password: string) {
  // First, so the checklist knows it before the field changes.
  emit('generate', password)
  visible.value = true
  fillInput(document.getElementById(props.id) as HTMLInputElement | null, password)
}
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
      <GeneratePasswordButton
        v-if="autocomplete === 'new-password'"
        @generate="fillGenerated"
      />
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
