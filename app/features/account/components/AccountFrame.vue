<script setup lang="ts">
/**
 * One account page (step 5.2, D97): a back link, the title and a line under it, in a task frame
 * (`TaskFrame`: a card from `sm`, the full screen with the actions at the bottom on phones). With
 * an `icon` or an `illustration` the page is a message (check your email, verified, a link that
 * doesn't work): centered. `aside` is the picture panel's words beside the card from `sm`
 * (`AccountAside`); without it the card's top row shows the cafe and the light/dark button there.
 */
import type { RouteLocationRaw } from 'vue-router'
import AccountAside from './AccountAside.vue'
import AccountBrand from './AccountBrand.vue'

const props = defineProps<{
  title: string
  description?: string
  back?: { label: string, to: RouteLocationRaw }
  icon?: string
  iconColor?: 'primary' | 'success' | 'warning'
  /** One of the app's illustrations (`i-app-…`, 4:3), in place of an icon. */
  illustration?: string
  aside?: { title: string, text: string }
}>()

const ICON_CLASS = { primary: 'text-primary', success: 'text-success', warning: 'text-warning' } as const
const message = computed(() => !!(props.icon || props.illustration))
</script>

<template>
  <TaskFrame>
    <template
      v-if="aside"
      #aside
    >
      <AccountAside v-bind="aside" />
    </template>
    <template #header>
      <div
        v-if="!aside"
        class="mb-4 flex items-center justify-between gap-2 max-sm:hidden"
      >
        <AccountBrand />
        <UColorModeButton />
      </div>
      <UButton
        v-if="back"
        :to="back.to"
        :label="back.label"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="link"
        size="sm"
        class="-ms-2.5 mb-2"
      />
      <div :class="message ? 'flex flex-col items-center text-center' : ''">
        <UIcon
          v-if="illustration"
          :name="illustration"
          class="mb-3 h-36 w-48"
        />
        <UIcon
          v-else-if="icon"
          :name="icon"
          class="mb-3 size-10"
          :class="ICON_CLASS[iconColor ?? 'primary']"
        />
        <h1 class="text-xl font-semibold text-highlighted">
          {{ title }}
        </h1>
        <p
          v-if="description"
          class="mt-1 text-sm text-muted"
        >
          {{ description }}
        </p>
        <slot name="description" />
      </div>
    </template>
    <slot />
    <template
      v-if="$slots.footer"
      #footer
    >
      <slot name="footer" />
    </template>
  </TaskFrame>
</template>
