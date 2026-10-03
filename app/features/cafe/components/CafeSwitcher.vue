<script setup lang="ts">
/**
 * The cafe at the top of a workspace (T2c, D144; always a menu since D145): its logo and name (D143)
 * open a menu with the account's other cafes (the same workspace there), the cafe's customer menu
 * in a new tab, and Your cafes. Each other cafe opens as a full page load (D141).
 *
 * @example
 * <CafeSwitcher workspace="admin" :collapsed="collapsed" />
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Workspace } from '#shared/contracts/account'
import { useAccountCafes } from '../composables/useAccountCafes'

const props = defineProps<{
  workspace: Workspace
  /** The sidebar is collapsed: the logo only. */
  collapsed?: boolean
}>()

const slug = useTenantSlug()
const { name, logoUrl } = useCafe()
const { data: cafes } = useAccountCafes()
const others = computed(() => otherCafes(cafes.value, slug.value, props.workspace))
const suffix = computed(() => (props.workspace === 'admin' ? 'Admin' : 'Counter'))

// The cafe's customer menu, opened in a new tab so the admin stays where it was (D145).
const menuUrl = computed(() => tenantUrl(slug.value, '/'))

const items = computed<DropdownMenuItem[][]>(() => [
  ...(others.value.length
    ? [[{ label: 'Switch cafe', type: 'label' as const }, ...others.value.map(cafe => ({
        label: cafe.name,
        description: `/c/${cafe.slug}`,
        avatar: cafe.logoUrl ? { src: cafe.logoUrl, alt: '' } : undefined,
        icon: cafe.logoUrl ? undefined : 'i-lucide-coffee',
        to: workspaceUrl(cafe.slug, props.workspace),
        external: true,
      }))]]
    : []),
  [
    { label: 'View menu', description: 'Opens in a new tab', icon: 'i-lucide-external-link', to: menuUrl.value, target: '_blank' },
    { label: 'All your cafes', icon: 'i-lucide-store', to: CAFES_PATH },
  ],
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'start' }"
    :ui="{ content: 'min-w-60' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :square="collapsed"
      :aria-label="`${name} ${suffix}: cafe menu`"
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
</template>
