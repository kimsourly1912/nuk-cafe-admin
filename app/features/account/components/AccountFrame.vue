<script setup lang="ts">
/**
 * One account page (step 5.2, D97): a back link, the title and a line under it, in a task frame
 * (`TaskFrame`: a card from `sm`, the full screen with the actions at the bottom on phones). With
 * an `icon` the page is a message (check your email, verified, a link that doesn't work): centered.
 */
import type { RouteLocationRaw } from 'vue-router'

defineProps<{
  title: string
  description?: string
  back?: { label: string, to: RouteLocationRaw }
  icon?: string
  iconColor?: 'primary' | 'success' | 'warning'
}>()

const ICON_CLASS = { primary: 'text-primary', success: 'text-success', warning: 'text-warning' } as const
</script>

<template>
  <TaskFrame>
    <template #header>
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
      <div :class="icon ? 'flex flex-col items-center text-center' : ''">
        <UIcon
          v-if="icon"
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
