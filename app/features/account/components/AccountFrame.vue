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
  /** The card's minimum height from `sm`, for a form that grows with its errors (`TaskFrame`'s `height`). */
  height?: 'tall' | 'taller'
}>()

const ICON_CLASS = { primary: 'text-primary', success: 'text-success', warning: 'text-warning' } as const
const message = computed(() => !!(props.icon || props.illustration))
</script>

<template>
  <div class="contents">
    <!-- Phones: back and title in the top bar (the layout's bar hides via `data-account-bar`). -->
    <div
      v-if="!message"
      data-account-bar
      class="flex w-full items-center gap-1 border-b border-default bg-default px-2 py-2 sm:hidden"
    >
      <UButton
        v-if="back"
        :to="back.to"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        :aria-label="back.label"
      />
      <span
        aria-hidden="true"
        class="min-w-0 flex-1 truncate font-semibold text-highlighted"
        :class="back ? '' : 'ps-2'"
      >{{ title }}</span>
      <UColorModeButton />
    </div>
    <TaskFrame :height="height">
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
          :class="message ? '' : 'max-sm:hidden'"
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
          <!-- On phones the bar shows the title; this stays the page's one heading for screen readers. -->
          <h1
            class="text-xl font-semibold text-highlighted"
            :class="message ? '' : 'max-sm:sr-only'"
          >
            {{ title }}
          </h1>
          <p
            v-if="description"
            class="text-sm text-muted"
            :class="message ? 'mt-1' : 'sm:mt-1'"
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
  </div>
</template>
