<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { ShortcutsHelp } from '#components'
import { AssistantPanel, useAssistant } from '~/features/assistant'
import { useAuth } from '~/features/auth'
import { CafeSwitcher } from '~/features/cafe'
import { SupportBanner } from '~/features/support'

const { user, logout, can } = useAuth()
/** A support visit, or support allowed: the strip above the admin (P5, D193). */
const supportStrip = computed(() => Boolean(user.value?.support || user.value?.supportAllowedUntil))
const allItems = navigationItems({ sampleData: useRuntimeConfig().public.sampleData.enabled })
const route = useRoute()
const router = useRouter()
const tenantPath = useTenantPath()
// Only the pages this session opens (D240): each page's `permission` meta, the one the route middleware checks.
const opens = (to: string) => {
  const permission = router.resolve(tenantPath(to)).meta.permission
  return !permission || can(permission)
}
// Features name their pages inside the cafe (`/admin/products`); the sidebar links to this cafe's (D141).
const sidebarItems = computed(() => withActiveItem(allowedNavigation(allItems, opens), splitTenantUrl(route.path)?.path ?? route.path)
  .map(group => group.map(item => (typeof item.to === 'string' ? { ...item, to: tenantPath(item.to) } : item))))
// Ctrl/⌘+B collapses the desktop sidebar; below `lg` it opens or closes the phone menu.
const { open, collapsed: sidebarCollapsed } = useSidebarShortcut()
// The sidebar's phone menu is Nuxt UI's own slide-over: Back closes it (D201).
useOverlayBack(open, () => {
  open.value = false
})
// The desktop sidebar and the phone menu both render the nav, so pick the copy that is on screen.
function scrollParent(el: HTMLElement) {
  let parent = el.parentElement
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
  return parent
}
// Centre the current page's link in the sidebar, so a page below the fold (Telegram) is not left hidden.
function revealActiveItem(instant = false) {
  const to = sidebarItems.value.flat().find(item => item.active)?.to
  if (typeof to !== 'string') return
  const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-sidebar-nav] a'))
    .find(anchor => anchor.getAttribute('href') === to && anchor.getClientRects().length > 0)
  const scroller = link && scrollParent(link)
  if (!link || !scroller) return
  const linkRect = link.getBoundingClientRect()
  const offset = linkRect.top - scroller.getBoundingClientRect().top - (scroller.clientHeight - linkRect.height) / 2
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollTo({ top: scroller.scrollTop + offset, behavior: instant || reduceMotion ? 'auto' : 'smooth' })
}
onMounted(() => revealActiveItem(true))
watch(() => route.path, () => revealActiveItem(), { flush: 'post' })
// The phone menu mounts when it opens, so centre the current page once it is on screen. It jumps
// there: a smooth scroll would play from the top on every open.
watch(open, isOpen => isOpen && nextTick(() => revealActiveItem(true)))
// Closing the search hands focus back to its button at the top of the sidebar, which scrolls the
// sidebar up and undoes the centring done on navigation; centre again once the palette has gone.
const searchOpen = ref(false)
watch(searchOpen, (isOpen) => {
  if (!isOpen) setTimeout(() => revealActiveItem(), 300)
})
/** Every page in the sidebar, for the search (Ctrl/⌘+K, D152). */
const searchPages = computed(() => sidebarItems.value.flat()
  .filter((item): item is typeof item & { label: string, to: string } => typeof item.to === 'string' && typeof item.label === 'string')
  .map(item => ({ label: item.label, icon: typeof item.icon === 'string' ? item.icon : undefined, to: item.to })))
// The help assistant (D109): only where an AI key is set.
const assistant = useAssistant()

const shortcutsHelp = useOverlay().create(ShortcutsHelp)
const showShortcuts = () => shortcutsHelp.open()
usePageShortcuts({ '?': showShortcuts })
// Ctrl/⌘+/ works while typing too (in a form, or in the assistant's own question box).
defineShortcuts({ 'meta_/': { usingInput: true, handler: assistant.toggle } })

const cafe = useCafe()
const installApp = useInstallApp()
const userMenu = computed<DropdownMenuItem[]>(() => [
  { label: user.value?.email, type: 'label' },
  { type: 'separator' },
  // Not inside the installed app itself (D203).
  ...(installApp.installed.value ? [] : [{ label: 'Install app', icon: 'i-lucide-monitor-smartphone', onSelect: () => void installApp.install(cafe.name.value ? `${cafe.name.value} Admin` : 'Admin') }]),
  { label: 'Change password', icon: 'i-lucide-key-round', to: tenantPath('/admin/change-password') },
  { label: 'Keyboard shortcuts', icon: 'i-lucide-keyboard', kbds: ['?'], onSelect: showShortcuts },
  { type: 'separator' },
  { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => logout() },
])
</script>

<template>
  <div :class="supportStrip ? 'fixed inset-0 flex flex-col print:static' : 'contents'">
    <!-- Support access (P5, D193): a strip above the whole admin while a visit or a grant is on; the
         dashboard then fills the rest of the screen instead of all of it. Without it, `contents`. -->
    <SupportBanner />
    <UDashboardGroup
      unit="rem"
      class="print:static print:block print:overflow-visible"
      :class="supportStrip && 'relative inset-auto min-h-0 flex-1 *:h-full! *:min-h-0!'"
    >
      <UDashboardSidebar
        v-model:open="open"
        v-model:collapsed="sidebarCollapsed"
        collapsible
        resizable
        class="bg-elevated/25 transition-[width] duration-200 ease-out motion-reduce:transition-none data-[dragging=true]:transition-none print:hidden"
        :ui="{ body: '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden', footer: 'lg:border-t lg:border-default' }"
      >
        <!-- Drag resizes; a click on the edge collapses or expands. -->
        <template #resize-handle="{ onMouseDown, onTouchStart, ui }">
          <SidebarResizeHandle
            v-model:collapsed="sidebarCollapsed"
            :handle-class="ui.handle()"
            :on-mouse-down="onMouseDown"
            :on-touch-start="onTouchStart"
          />
        </template>

        <template #header="{ collapsed }">
          <CafeSwitcher
            workspace="admin"
            :collapsed="collapsed"
          />
        </template>

        <template #default="{ collapsed }">
          <UDashboardSearchButton
            :collapsed="collapsed"
            label="Search"
            class="bg-transparent ring-default"
          />
          <div
            data-sidebar-nav
            class="contents"
          >
            <UNavigationMenu
              :collapsed="collapsed"
              :items="sidebarItems"
              orientation="vertical"
              tooltip
            />
          </div>
        </template>

        <template #footer="{ collapsed }">
          <div class="flex w-full flex-col gap-1">
            <!-- The cafe's customer menu in a new tab, to check a change as customers see it (D145). -->
            <UButton
              :label="collapsed ? undefined : 'View menu'"
              aria-label="View menu (opens in a new tab)"
              icon="i-lucide-external-link"
              color="neutral"
              variant="ghost"
              block
              :square="collapsed"
              class="justify-start"
              :to="tenantPath('/')"
              target="_blank"
            />
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
      <AdminSearch
        v-model:open="searchOpen"
        :pages="searchPages"
        @shortcuts="showShortcuts"
      />
    </UDashboardGroup>
  </div>
</template>
