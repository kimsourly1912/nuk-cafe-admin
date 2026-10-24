<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import { refDebounced } from '@vueuse/core'
import type { AdminSearchResult, AdminSearchSource } from '~/types/admin-search'

/**
 * The admin's search (Ctrl/⌘+K, D152): Nuxt UI's `UDashboardSearch`, opened by the sidebar's
 * Search button or the shortcut. Typing two characters or more asks every source at once (menu
 * items from the server's own search; the small libraries filtered here) and shows each one's
 * matches; the pages and a few actions are always there, filtered as you type. A source that
 * fails says so in its group; the others still answer.
 */
const props = defineProps<{
  /** The sidebar's pages, inside the cafe (`navigationItems`). */
  pages: { label: string, icon?: string, to: string }[]
}>()
const emit = defineEmits<{ shortcuts: [] }>()
/** Whether the palette is open, so the shell can react to it closing. */
const open = defineModel<boolean>('open', { default: false })
// Nuxt UI's own modal: Back closes it (D201).
useOverlayBack(open, () => {
  open.value = false
})

const tenantPath = useTenantPath()
const sources = adminSearchSources()

const term = ref('')
const searched = refDebounced(computed(() => term.value.trim()), 250)

type Outcome = { source: AdminSearchSource, results: AdminSearchResult[], failed: boolean }
const { data, pending } = useApiQuery(
  'admin-search:results',
  async (): Promise<Outcome[]> => {
    const text = searched.value
    if (text.length < 2) return []
    const answers = await Promise.allSettled(sources.map(source => source.search(text)))
    return answers.map((answer, i) => ({
      source: sources[i]!,
      results: answer.status === 'fulfilled' ? answer.value : [],
      failed: answer.status === 'rejected',
    }))
  },
  { watch: [searched], server: false, default: () => [] },
)

function toItem(result: AdminSearchResult): CommandPaletteItem {
  return {
    label: result.label,
    suffix: result.suffix,
    ...(result.image ? { avatar: { src: result.image, alt: '' } } : { icon: result.icon }),
    to: tenantPath(result.page),
  }
}

const groups = computed<CommandPaletteGroup[]>(() => {
  const found = (data.value ?? [])
    .filter(outcome => outcome.failed || outcome.results.length)
    .map(outcome => ({
      id: outcome.source.id,
      label: outcome.source.label,
      // The sources searched already: the palette shows what they answered.
      ignoreFilter: true,
      items: outcome.failed
        ? [{ label: `Couldn't search ${outcome.source.label.toLowerCase()}. Try again.`, icon: 'i-lucide-circle-alert', disabled: true }]
        : outcome.results.map(toItem),
    }))
  return [
    ...found,
    {
      id: 'actions',
      label: 'Actions',
      items: [
        { label: 'New menu item', icon: 'i-lucide-plus', to: tenantPath('/admin/products/new') },
        { label: 'View menu', suffix: 'Opens the customer menu in a new tab', icon: 'i-lucide-external-link', to: tenantPath('/'), target: '_blank' },
        { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: () => emit('shortcuts') },
      ],
    },
    {
      id: 'pages',
      label: 'Go to',
      items: props.pages.map(page => ({ label: page.label, icon: page.icon, to: page.to })),
    },
  ]
})
</script>

<template>
  <UDashboardSearch
    v-model:open="open"
    v-model:search-term="term"
    :groups="groups"
    :loading="pending && term.trim().length >= 2"
    :color-mode="false"
    placeholder="Search menu items, categories, pages…"
    title="Search"
    description="Find a menu item, a category, an option set, an add-on group or a page"
  />
</template>
