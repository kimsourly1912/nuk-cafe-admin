<script setup lang="ts">
import { isAdminPath, useAuth } from '~/features/auth'
import { isCounterPath, useCounterSession } from '~/features/counter'
import { isPlatformPath, usePlatformSession } from '~/features/platform'
import { webManifestPath } from '#shared/contracts/cafe'
import type { Workspace } from '#shared/contracts/account'

// Browser tab title from each route file's `definePageMeta({ title })`, so tabs are told apart.
// The admin workspace, the counter (D102) and the customer site (D93) name themselves after the
// cafe of the address (D143); the platform console (D142) after the platform.
const route = useRoute()
const cafe = useCafe()
const siteName = computed(() => {
  // The platform console, and Your cafes, which spans cafes (D144).
  if (isPlatformPath(route.path) || route.path === CAFES_PATH) return 'Angder'
  const name = cafe.name.value
  if (isAdminPath(route.path)) return name ? `${name} Admin` : 'Admin'
  if (isCounterPath(route.path)) return name ? `${name} Counter` : 'Counter'
  return name
})
// The workspaces' tabs stay open all day: they're offered a new build when one is deployed (D149).
// The customer site just loads it on the next page change.
const isWorkspace = computed(() => isAdminPath(route.path) || isCounterPath(route.path) || isPlatformPath(route.path))
const rechecking = useState('session-identity:rechecking', () => false)
// A workspace page whose session just ended (expired, signed out in another tab) is on its way to
// sign-in (`plugins/api.ts`): the skeleton until then, not the page's empty states without its data.
// The router's route, not `useRoute()`: here that one follows the page on screen and only moves
// once <NuxtPage> renders the next page, which the skeleton keeps from ever happening.
const auth = useAuth()
const counter = useCounterSession()
const platform = usePlatformSession()
const currentRoute = useRouter().currentRoute
const sessionEnded = computed(() => {
  const { path, meta } = currentRoute.value
  if (meta.public) return false
  if (isAdminPath(path)) return !auth.user.value
  if (isCounterPath(path)) return !counter.user.value
  if (isPlatformPath(path)) return !platform.user.value
  return false
})

// The counter and the admin install as the cafe's own apps (D202): each links its manifest. The
// customer site and the platform console don't.
const slug = useOptionalTenantSlug()
const colorMode = useColorMode()
const installable = computed<Workspace | null>(() => isCounterPath(route.path) ? 'counter' : isAdminPath(route.path) ? 'admin' : null)

// The whole input is a computed: unhead calls a template function only when a title changes, so a
// new one (on a rename, D143) must arrive as a new head input.
useHead(computed(() => {
  const site = siteName.value
  const app = installable.value
  return {
    title: route.meta.title,
    titleTemplate: (title?: string) => (title && site ? `${title} · ${site}` : title || site),
    link: app
      ? [
          { rel: 'manifest', href: webManifestPath(slug.value!, app) },
          { rel: 'apple-touch-icon', href: '/pwa/apple-touch-icon-180.png' },
        ]
      : [],
    meta: app
      ? [
          { name: 'mobile-web-app-capable', content: 'yes' },
          { name: 'apple-mobile-web-app-title', content: site },
          // The installed app's title bar follows the chosen color mode (D96), not the system's.
          { name: 'theme-color', content: colorMode.value === 'dark' ? '#1c1917' : '#ffffff' },
        ]
      : [],
  }
}))
</script>

<template>
  <UApp>
    <NuxtLayout>
      <TaskFrameSkeleton
        v-if="(rechecking && isWorkspace) || sessionEnded"
        :fields="2"
      />
      <NuxtPage v-else />
    </NuxtLayout>
    <!-- Bottom center, stacked: the update notice in the workspaces (D149), the offline notice everywhere. -->
    <div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      <NewVersionBanner v-if="isWorkspace" />
      <OfflineBanner />
    </div>
  </UApp>
</template>
