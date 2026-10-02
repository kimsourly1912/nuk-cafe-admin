<script setup lang="ts">
/** The header of the customer's order pages: the cafe (back to the menu), color mode and the account. */
import { AccountButton } from '~/features/account'
</script>

<template>
  <header class="border-b border-default bg-default">
    <div class="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
      <NuxtLink
        to="/"
        class="flex items-center gap-2 font-semibold text-highlighted"
      >
        <UIcon
          name="i-lucide-coffee"
          class="size-5 text-primary"
        />
        NUK Cafe
      </NuxtLink>
      <div class="ms-auto flex items-center gap-2">
        <UColorModeButton class="max-lg:hidden" />
        <AccountButton />
      </div>
    </div>
  </header>
</template>
