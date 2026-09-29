<script setup lang="ts">
/**
 * "All categories" (D93): main categories with their item counts; a chevron shows a main category's
 * sub-categories. The one being read is highlighted, and its main category starts expanded (the
 * others collapsed). Choosing any entry scrolls the menu to it.
 */
import type { MenuSection } from '../utils/menu'

const props = defineProps<{
  sections: MenuSection[]
  activeMainId?: string
  activeSubId?: string
}>()
const emit = defineEmits<{ go: [id: string] }>()

const expanded = ref(new Set(props.activeMainId ? [props.activeMainId] : []))
function toggle(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const entryClass = (active: boolean) => [
  'flex w-full min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm',
  active ? 'bg-primary/10 font-medium text-primary' : 'text-default hover:bg-elevated',
]
</script>

<template>
  <ul
    class="space-y-0.5"
    aria-label="All categories"
  >
    <li
      v-for="section in sections"
      :key="section.id"
    >
      <div class="flex items-center gap-1">
        <button
          type="button"
          :class="entryClass(section.id === activeMainId && !activeSubId)"
          :aria-current="section.id === activeMainId ? 'true' : undefined"
          @click="emit('go', section.id)"
        >
          <span class="truncate">{{ section.name }}</span>
          <span class="shrink-0 text-xs text-muted">{{ section.count }}</span>
        </button>
        <UButton
          v-if="section.subSections.length"
          :icon="expanded.has(section.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="`${expanded.has(section.id) ? 'Hide' : 'Show'} ${section.name} sub-categories`"
          :aria-expanded="expanded.has(section.id)"
          @click="toggle(section.id)"
        />
      </div>
      <ul
        v-if="section.subSections.length && expanded.has(section.id)"
        class="ms-3 space-y-0.5 border-s border-default ps-2"
      >
        <li
          v-for="sub in section.subSections"
          :key="sub.id"
        >
          <button
            type="button"
            :class="entryClass(sub.id === activeSubId)"
            :aria-current="sub.id === activeSubId ? 'true' : undefined"
            @click="emit('go', sub.id)"
          >
            <span class="truncate">{{ sub.name }}</span>
            <span class="shrink-0 text-xs text-muted">{{ sub.items.length }}</span>
          </button>
        </li>
      </ul>
    </li>
  </ul>
</template>
