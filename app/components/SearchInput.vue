<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'

/**
 * Search box for list toolbars. Applies as you type (after `delay` ms without typing), or at once
 * on Enter or Clear. The model receives the trimmed text.
 *
 * @example
 * <SearchInput v-model="filters.search" placeholder="Search categories…" />
 */
const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{ placeholder?: string, delay?: number }>(), {
  placeholder: 'Search…',
  delay: 300,
})

const text = ref(model.value)

function apply() {
  const value = text.value.trim()
  if (value !== model.value) model.value = value
}

watchDebounced(text, apply, { debounce: props.delay })

// Changed from outside (Clear filters, URL): show it, unless it's just the trimmed input.
watch(model, (value) => {
  if (value !== text.value.trim()) text.value = value
})

function clear() {
  text.value = ''
  apply()
}
</script>

<template>
  <UInput
    v-model="text"
    type="search"
    icon="i-lucide-search"
    :placeholder="placeholder"
    :aria-label="placeholder"
    :ui="{ trailing: 'pe-1' }"
    @keydown.enter="apply"
  >
    <template
      v-if="text"
      #trailing
    >
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        icon="i-lucide-x"
        aria-label="Clear search"
        @click="clear"
      />
    </template>
  </UInput>
</template>
