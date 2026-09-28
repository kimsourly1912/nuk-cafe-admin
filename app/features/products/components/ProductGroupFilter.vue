<script setup lang="ts">
/**
 * The "Offers Milk choices ×" filter on Menu items (D75), set by the Add-ons page's "View all".
 * Its own component so the add-on groups load only while this filter is on.
 */
import { useModifierGroupOptions } from '~/features/modifier-groups'

const props = defineProps<{ groupId: string }>()
const emit = defineEmits<{ clear: [] }>()

const { data } = useModifierGroupOptions()
const name = computed(() => data.value.find(g => g.id === props.groupId)?.name ?? 'an add-on group')
</script>

<template>
  <UButton
    :label="`Offers ${name}`"
    icon="i-lucide-circle-plus"
    trailing-icon="i-lucide-x"
    color="neutral"
    variant="soft"
    :aria-label="`Offers ${name}: remove this filter`"
    @click="emit('clear')"
  />
</template>
