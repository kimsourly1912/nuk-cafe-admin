<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { useAuth } from '~/features/auth'

const { user, logout } = useAuth()
const open = ref(false)

const userMenu = computed<DropdownMenuItem[]>(() => [
  { label: user.value?.username, type: 'label' },
  { type: 'separator' },
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
          to="/"
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
            :label="collapsed ? undefined : (user?.displayName || user?.username)"
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
