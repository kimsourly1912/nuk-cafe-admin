<script setup lang="ts" generic="T extends string">
/**
 * Tabs in a `UDashboardToolbar` (ui.md → Tabs): the toolbar's full-width line is the tabs' line, so
 * the tabs drop their own and sit on it, the active tab's underline on the toolbar's border. Tabs
 * anywhere else keep Nuxt UI's `link` line.
 *
 * @example
 * <UDashboardToolbar><ToolbarTabs v-model="tab" :items="tabs" aria-label="Branch sections" /></UDashboardToolbar>
 */
import type { TabsItem } from '@nuxt/ui'

defineProps<{ items: (TabsItem & { value: T })[] }>()
const tab = defineModel<T>({ required: true })

// Labels never cut: a row that doesn't fit scrolls, the chosen tab centered (D128).
const root = useTemplateRef('root')
useCenteredTab(root, () => tab.value)
</script>

<template>
  <UTabs
    ref="root"
    v-model="tab"
    :items="items"
    :content="false"
    variant="link"
    :ui="{ root: 'min-w-0 max-w-full self-end max-sm:-mb-2', list: 'mb-0 border-b-0 px-0', indicator: 'bottom-0' }"
  />
</template>
