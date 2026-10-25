<script setup lang="ts">
/**
 * The password rules as a checklist under a new-password field (D210): each line ticks as it's met
 * while the person types. "Not a commonly used password" is checked once typing pauses
 * (`usePasswordLeakCheck`) and turns red for a leaked password, or when the server refused this
 * exact one on save. A short password is the field's own error, on blur or submit, so it isn't red
 * here too. The list is a polite live region, so a line changing state is read out once.
 */
import type { PasswordRequirementState, PasswordRequirementsInput } from '~/utils/password-requirements'
import { passwordRequirements } from '~/utils/password-requirements'

const props = defineProps<Omit<PasswordRequirementsInput, 'leak'> & {
  /** The password the Generate button made: ticked without a check while the field holds it. */
  generated?: string
}>()

const { state: leak } = usePasswordLeakCheck(() => props.password, () => props.generated)
const requirements = computed(() => passwordRequirements({ password: props.password, confirm: props.confirm, refused: props.refused, leak: leak.value }))

const look: Record<PasswordRequirementState, { icon: string, class: string, status: string }> = {
  pending: { icon: 'i-lucide-circle', class: 'text-muted', status: 'not yet' },
  checking: { icon: 'i-lucide-loader-circle', class: 'text-muted', status: 'checking' },
  met: { icon: 'i-lucide-circle-check', class: 'text-success', status: 'done' },
  failed: { icon: 'i-lucide-circle-x', class: 'text-error', status: 'refused' },
}
</script>

<template>
  <ul
    aria-label="Password requirements"
    aria-live="polite"
    class="space-y-1 text-sm"
    data-testid="password-requirements"
  >
    <li
      v-for="requirement in requirements"
      :key="requirement.id"
      :data-state="requirement.state"
      class="flex items-start gap-1.5"
      :class="look[requirement.state].class"
    >
      <UIcon
        :name="look[requirement.state].icon"
        class="mt-0.5 size-4 shrink-0"
        :class="{ 'animate-spin': requirement.state === 'checking' }"
      />
      <span>
        {{ requirement.label }}<span class="sr-only">: {{ look[requirement.state].status }}</span>
        <span
          v-if="requirement.hint"
          class="block text-xs text-muted"
        >{{ requirement.hint }}</span>
      </span>
    </li>
  </ul>
</template>
