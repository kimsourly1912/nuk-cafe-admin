<script setup lang="ts">
/**
 * A password field with a show/hide button inside it (the admin's sign-in does the same). A new
 * password also gets the Generate button (D210): it fills the field, shows what it made and emits
 * it, so the page's checklist can skip checking it.
 */
import { fillInput } from '~/utils/password-requirements'

defineProps<{ autocomplete: 'current-password' | 'new-password' }>()
const model = defineModel<string>({ required: true })
const visible = ref(false)
const emit = defineEmits<{ generate: [password: string] }>()

// The input takes its `UFormField`'s id, so the label matches it in the server's HTML too. An `id`
// set here would replace that id only after the label was rendered on the server.
const input = useTemplateRef('input')
/** For the show/hide button's `aria-controls`; known once mounted (the server renders none). */
const inputId = ref<string>()
onMounted(() => {
  inputId.value = input.value?.inputRef?.id
})

function fillGenerated(password: string) {
  // First, so the checklist knows it before the field changes.
  emit('generate', password)
  visible.value = true
  fillInput(input.value?.inputRef ?? null, password)
}
</script>

<template>
  <UInput
    ref="input"
    v-model="model"
    :type="visible ? 'text' : 'password'"
    :autocomplete="autocomplete"
    icon="i-lucide-lock"
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
        :aria-controls="inputId"
        @click="visible = !visible"
      />
    </template>
  </UInput>
</template>
