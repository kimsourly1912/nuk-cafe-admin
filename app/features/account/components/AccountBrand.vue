<script setup lang="ts">
/**
 * The cafe the person came from (D143): its logo and name, linking back to it; none without one
 * (D221). Above the account pages: the layout's bar on phones, the picture panel or the card from `sm`.
 */
import { useAccountHome } from '../composables/useAccountHome'

const home = useAccountHome()
const { name, logoUrl } = useCafe(() => splitTenantUrl(home.value)?.slug ?? null)
</script>

<template>
  <NuxtLink
    :to="home"
    class="flex min-w-0 items-center gap-2 font-semibold text-highlighted"
  >
    <CafeLogo
      :url="logoUrl"
      class="size-5 shrink-0"
    />
    <span class="truncate">{{ name }}</span>
  </NuxtLink>
</template>
