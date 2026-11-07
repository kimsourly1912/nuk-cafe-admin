<script setup lang="ts">
/**
 * The picture panel of the sign-in style pages (owner mockup 2026-11-02, D97 follow-up), beside the
 * form from `sm` (`TaskFrame`'s `aside`): the cafe photo fills the panel, and on its light top sit a
 * row with the light/dark button (the default slot before it: the account pages' cafe), a large line
 * about the page and a line under it. `data-aside` lets the `auth` layout hide its own light/dark
 * button from `sm`. Used by the account pages (`AccountAside`), the workspaces' sign-in
 * and change-password pages and the console's.
 *
 * The photo is light in both modes, so the panel keeps the light theme's colors (Nuxt UI's `light`
 * class) and its words stay readable in dark mode. Behind them a frosted veil fades into the photo:
 * the owner's one exception to ui.md §1.7's no-blur rule. Lazy, so phones (where the panel is hidden)
 * never load the photo.
 *
 * @example
 * <TaskFrame>
 *   <template #aside><AuthAside title="Welcome back" text="Sign in to manage your cafe." /></template>
 *   …
 * </TaskFrame>
 */
import background from '~/assets/img/nuk-cafe-auth-background.webp'

/** `colorMode: false`: the page's card has the light/dark button instead. */
withDefaults(defineProps<{ title: string, text: string, colorMode?: boolean }>(), { colorMode: true })
// Vite can resolve the client import to an absolute URL; SSR must use that same form.
const backgroundUrl = new URL(background, useRequestURL().origin).href
</script>

<template>
  <div
    class="light relative h-full"
    data-aside
  >
    <img
      :src="backgroundUrl"
      alt=""
      loading="lazy"
      class="absolute inset-0 size-full object-cover object-bottom"
    >
    <div class="absolute inset-x-0 top-0 h-full max-h-80 bg-default/50 mask-b-from-50% backdrop-blur-md" />
    <div class="relative space-y-6 p-6">
      <div
        v-if="colorMode || $slots.default"
        class="flex items-center justify-between gap-2"
      >
        <slot />
        <UColorModeButton
          v-if="colorMode"
          class="ms-auto"
        />
      </div>
      <div class="space-y-2">
        <p class="text-3xl font-semibold text-highlighted">
          {{ title }}
        </p>
        <p class="text-sm text-default">
          {{ text }}
        </p>
      </div>
    </div>
  </div>
</template>
