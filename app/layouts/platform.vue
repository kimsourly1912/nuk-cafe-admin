<script setup lang="ts">
/**
 * The platform console's shell (D142): Nuxt UI's dashboard, like a cafe's admin, with the
 * platform's own sidebar. Its name is the working name "NUK Platform" until the owner decides
 * (QT1).
 */
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import { PLATFORM_CHANGE_PASSWORD, PLATFORM_HOME, usePlatformSession } from '~/features/platform'

const { user, signOut } = usePlatformSession()
const route = useRoute()
const open = ref(false)

// A cafe's own page is still under Cafes.
const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Cafes', icon: 'i-lucide-store', to: PLATFORM_HOME, active: route.path === PLATFORM_HOME || route.path.startsWith('/platform/cafes/') },
])

const userMenu = computed<DropdownMenuItem[]>(() => [
  { label: user.value?.email, type: 'label' },
  { type: 'separator' },
  { label: 'Change password', icon: 'i-lucide-key-round', to: PLATFORM_CHANGE_PASSWORD },
  { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => signOut() },
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
          :to="PLATFORM_HOME"
          class="flex items-center gap-2 font-semibold"
        >
          <UIcon
            name="i-lucide-layers"
            class="size-5 shrink-0 text-primary"
          />
          <span v-if="!collapsed">NUK Platform</span>
        </NuxtLink>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="items"
          orientation="vertical"
          tooltip
        />
      </template>

      <template #footer="{ collapsed }">
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
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
