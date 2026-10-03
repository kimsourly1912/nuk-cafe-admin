<!--
  The customer's account pages (step 5.2, D97): the cafe's name and the color-mode button above a
  task frame (TaskFrame), centered from sm; on phones a bar at the top and the frame below it.
-->
<script setup lang="ts">
import { useAccountHome } from '~/features/account'

const home = useAccountHome()
// The cafe the person came from (D143): its name and logo above the form.
const fallback = useRuntimeConfig().public.defaultTenant
const { name, logoUrl } = useCafe(() => splitTenantUrl(home.value)?.slug ?? fallback)
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center bg-muted sm:justify-center sm:p-4">
    <div class="flex w-full flex-1 flex-col sm:max-w-sm sm:flex-none">
      <div class="flex items-center justify-between gap-2 border-default bg-default px-4 py-2 max-sm:border-b sm:mb-2 sm:bg-transparent sm:px-1">
        <NuxtLink
          :to="home"
          class="flex items-center gap-2 font-semibold text-highlighted"
        >
          <CafeLogo
            :url="logoUrl"
            class="size-5"
          />
          {{ name }}
        </NuxtLink>
        <UColorModeButton />
      </div>
      <slot />
    </div>
  </div>
</template>
