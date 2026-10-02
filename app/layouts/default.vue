<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { ShortcutsHelp } from '#components'
import { AssistantPanel, useAssistant } from '~/features/assistant'
import { CHANGE_PASSWORD_PATH, useAuth } from '~/features/auth'

const { user, logout } = useAuth()
const allItems = navigationItems({ sampleData: useRuntimeConfig().public.sampleData.enabled })
const route = useRoute()
const sidebarItems = computed(() => withActiveItem(allItems, route.path))
const open = ref(false)
// The help assistant (D109): only where an AI key is set.
const assistant = useAssistant()

const shortcutsHelp = useOverlay().create(ShortcutsHelp)
const showShortcuts = () => shortcutsHelp.open()
usePageShortcuts({ '?': showShortcuts })
// Ctrl/⌘+/ works while typing too (in a form, or in the assistant's own question box).
defineShortcuts({ 'meta_/': { usingInput: true, handler: assistant.toggle } })

const userMenu = computed<DropdownMenuItem[]>(() => [
  { label: user.value?.email, type: 'label' },
  { type: 'separator' },
  { label: 'Change password', icon: 'i-lucide-key-round', to: CHANGE_PASSWORD_PATH },
  { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: showShortcuts },
  { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => logout() },
])
</script>

<template>
  <UDashboardGroup
    unit="rem"
    class="print:static print:block print:overflow-visible"
  >
    <UDashboardSidebar
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25 print:hidden"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <NuxtLink
          to="/admin"
          class="flex items-center gap-2 font-semibold"
        >
          <UIcon
            name="i-lucide-coffee"
            class="size-5 shrink-0 text-primary"
          />
          <span v-if="!collapsed">NUK Cafe Admin</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="sidebarItems"
          orientation="vertical"
          tooltip
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex w-full flex-col gap-1">
          <UButton
            v-if="assistant.enabled.value"
            :label="collapsed ? undefined : 'Assistant'"
            :aria-label="collapsed ? 'Assistant' : undefined"
            icon="i-lucide-sparkles"
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            class="justify-start"
            :aria-pressed="assistant.open.value"
            @click="assistant.toggle(); open = false"
          >
            <template
              v-if="!collapsed"
              #trailing
            >
              <span class="ms-auto hidden gap-0.5 lg:flex">
                <UKbd value="meta" />
                <UKbd value="/" />
              </span>
            </template>
          </UButton>
          <div
            class="flex w-full items-center gap-1"
            :class="{ 'flex-col': collapsed }"
          >
            <UDropdownMenu
              :items="userMenu"
              :content="{ align: 'start' }"
              class="min-w-0 flex-1"
            >
              <UButton
                :label="collapsed ? undefined : (user?.name || user?.email)"
                icon="i-lucide-circle-user"
                color="neutral"
                variant="ghost"
                block
                :square="collapsed"
                class="justify-start"
              />
            </UDropdownMenu>
            <UColorModeButton />
          </div>
        </div>
      </template>
    </UDashboardSidebar>

    <slot />

    <!-- Mounted with the shell, closed: only the Ask button or Ctrl/⌘+/ opens it, where it's on.
         Mounting it at the moment it opens would let USidebar close it again on phones. -->
    <AssistantPanel class="print:hidden" />
  </UDashboardGroup>
</template>
