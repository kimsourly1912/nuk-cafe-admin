<script setup lang="ts">
/**
 * The cafe at the top of a workspace (T2c, D144): its logo and name (D143), and for an account that
 * runs more than one cafe, a menu to open the same workspace in another cafe, or Your cafes. Each
 * other cafe opens as a full page load (D141). With one cafe it's a plain link to `home`.
 *
 * @example
 * <CafeSwitcher workspace="admin" :home="tenantPath('/admin')" :collapsed="collapsed" />
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Workspace } from '#shared/contracts/account'
import { useAccountCafes } from '../composables/useAccountCafes'

const props = defineProps<{
  workspace: Workspace
  /** Where the cafe's name leads when there is no other cafe: the workspace's start page. */
  home: string
  /** The sidebar is collapsed: the logo only. */
  collapsed?: boolean
}>()

const slug = useTenantSlug()
const { name, logoUrl } = useCafe()
const { data: cafes } = useAccountCafes()
const others = computed(() => otherCafes(cafes.value, slug.value, props.workspace))
const suffix = computed(() => (props.workspace === 'admin' ? 'Admin' : 'Counter'))

const items = computed<DropdownMenuItem[][]>(() => [
  [{ label: 'Switch cafe', type: 'label' }],
  others.value.map(cafe => ({
    label: cafe.name,
    description: `/c/${cafe.slug}`,
    avatar: cafe.logoUrl ? { src: cafe.logoUrl, alt: '' } : undefined,
    icon: cafe.logoUrl ? undefined : 'i-lucide-coffee',
    to: workspaceUrl(cafe.slug, props.workspace),
    external: true,
  })),
  [{ label: 'All your cafes', icon: 'i-lucide-store', to: CAFES_PATH }],
])
</script>

<template>
  <UDropdownMenu
    v-if="others.length"
    :items="items"
    :content="{ align: 'start' }"
    :ui="{ content: 'min-w-60' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :square="collapsed"
      :aria-label="`${name} ${suffix}: switch cafe`"
      class="min-w-0 font-semibold"
      :class="collapsed ? '' : 'w-full'"
    >
      <CafeLogo
        :url="logoUrl"
        class="size-5"
      />
      <template v-if="!collapsed">
        <span class="truncate">{{ name }} {{ suffix }}</span>
        <UIcon
          name="i-lucide-chevrons-up-down"
          class="ms-auto size-4 shrink-0 text-dimmed"
        />
      </template>
    </UButton>
  </UDropdownMenu>
  <NuxtLink
    v-else
    :to="home"
    class="flex min-w-0 items-center gap-2 font-semibold"
  >
    <CafeLogo
      :url="logoUrl"
      class="size-5"
    />
    <span
      v-if="!collapsed"
      class="truncate"
    >{{ name }} {{ suffix }}</span>
  </NuxtLink>
</template>
