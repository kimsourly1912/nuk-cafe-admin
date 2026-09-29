<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { ShortcutsHelp } from '#components'
import { CHANGE_PASSWORD_PATH, useAuth } from '~/features/auth'

const { user, logout } = useAuth()
const open = ref(false)

const shortcutsHelp = useOverlay().create(ShortcutsHelp)
const showShortcuts = () => shortcutsHelp.open()
usePageShortcuts({ '?': showShortcuts })

const userMenu = computed<DropdownMenuItem[]>(() => [
  { label: user.value?.email, type: 'label' },
  { type: 'separator' },
  { label: 'Change password', icon: 'i-lucide-key-round', to: CHANGE_PASSWORD_PATH },
  { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: showShortcuts },
  { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => logout() },
])
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
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
          :items="navigationItems"
          orientation="vertical"
          tooltip
        />
      </template>

      <template #footer="{ collapsed }">
        <UDropdownMenu
          :items="userMenu"
          :content="{ align: 'start' }"
          class="w-full"
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
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
