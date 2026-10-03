<!--
  The customer's account pages (step 5.2, D97): the cafe's name and the color-mode button above a
  task frame (TaskFrame), centered from sm; on phones a bar at the top and the frame below it.
-->
<script setup lang="ts">
import { useAccountHome } from '~/features/account'

const home = useAccountHome()
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center bg-muted sm:justify-center sm:p-4">
    <div class="flex w-full flex-1 flex-col sm:max-w-sm sm:flex-none">
      <div class="flex items-center justify-between gap-2 border-default bg-default px-4 py-2 max-sm:border-b sm:mb-2 sm:bg-transparent sm:px-1">
        <NuxtLink
          :to="home"
          class="flex items-center gap-2 font-semibold text-highlighted"
        >
          <UIcon
            name="i-lucide-coffee"
            class="size-5 text-primary"
          />
          NUK Cafe
        </NuxtLink>
        <UColorModeButton />
      </div>
      <slot />
    </div>
  </div>
</template>
