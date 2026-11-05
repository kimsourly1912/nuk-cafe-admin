<!--
  The customer's account pages (step 5.2, D97): a task frame (TaskFrame), centered from sm, where the
  page shows the cafe's name and the color-mode button itself (the picture panel, or the card's top
  row); on phones a bar at the top with them and the frame below it.
-->
<script setup lang="ts">
import { AccountBrand } from '~/features/account'
</script>

<template>
  <div class="group flex min-h-dvh flex-col items-center bg-muted sm:justify-center sm:p-4">
    <div class="flex w-full flex-1 flex-col items-center sm:flex-none">
      <!-- A page with its own phone bar (`data-account-bar`, AccountFrame: back and title) hides this one. -->
      <div class="flex w-full items-center justify-between gap-2 border-b border-default bg-default px-4 py-2 group-has-data-account-bar:hidden sm:hidden">
        <AccountBrand />
        <!-- On the right even when there's no cafe to name (no brand). -->
        <UColorModeButton class="ms-auto" />
      </div>
      <slot />
    </div>
  </div>
</template>
