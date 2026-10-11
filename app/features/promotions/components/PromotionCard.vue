<script setup lang="ts">
/**
 * A promotion in the library (M1, D163): its poster, name (which opens it), phase, the discount as
 * customers see it, what it covers and when it runs. The ⋮ menu holds what fits its phase: Edit,
 * Publish, End now, Delete.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Promotion } from '#shared/contracts/menu-promotions'
import { PHASES, targetsText, timingText, whenText } from '../schemas/promotion-form'

const props = defineProps<{
  promotion: Promotion
  actions: DropdownMenuItem[]
  today: string
  busy?: boolean
}>()

const tenantPath = useTenantPath()
const phase = computed(() => PHASES[props.promotion.phase])
const ended = computed(() => props.promotion.phase === 'ended')
</script>

<template>
  <UCard
    as="article"
    variant="outline"
    :aria-busy="busy || undefined"
    :class="busy && 'pointer-events-none opacity-50'"
    :ui="{ root: 'relative', body: 'flex gap-4 p-4 sm:p-4' }"
  >
    <div class="aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-md bg-elevated ring ring-default sm:w-24">
      <img
        v-if="promotion.poster"
        :src="promotion.poster.url"
        alt=""
        loading="lazy"
        class="size-full object-cover"
        :class="ended && 'opacity-60 grayscale'"
      >
      <div
        v-else
        class="flex size-full items-center justify-center text-dimmed"
      >
        <UIcon
          name="i-lucide-badge-percent"
          class="size-7"
        />
      </div>
    </div>

    <div class="min-w-0 flex-1 space-y-1.5">
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <ULink
            :to="tenantPath(`/admin/promotions/${promotion.id}`)"
            class="break-words font-semibold after:absolute after:inset-0"
            :class="ended ? 'text-muted' : 'text-highlighted'"
          >
            {{ promotion.name }}
          </ULink>
        </div>
        <UBadge
          :label="phase.label"
          :color="phase.color"
          :variant="phase.variant"
          size="sm"
          class="shrink-0"
        />
        <UIcon
          v-if="busy"
          name="i-lucide-loader-circle"
          class="size-5 shrink-0 animate-spin text-muted"
          aria-label="Working…"
        />
        <UDropdownMenu
          v-else-if="actions.length"
          :items="actions"
          :content="{ align: 'end' }"
        >
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="sm"
            class="relative -my-1"
            :aria-label="`Actions for ${promotion.name}`"
          />
        </UDropdownMenu>
      </div>
      <p
        class="text-lg font-semibold"
        :class="ended ? 'text-muted' : 'text-primary'"
      >
        {{ promotion.label }}
      </p>
      <p class="truncate text-sm text-default">
        {{ targetsText(promotion) }}
      </p>
      <p class="text-sm text-muted">
        {{ whenText(promotion.startsOn, promotion.endsOn) }}
        <span aria-hidden="true">·</span>
        {{ timingText(promotion, today) }}
      </p>
      <p
        v-if="promotion.branches.length"
        class="truncate text-xs text-muted"
      >
        <UIcon
          name="i-lucide-store"
          class="size-3.5 align-[-2px]"
        />
        {{ promotion.branches.map(b => b.name).join(', ') }}
      </p>
    </div>
  </UCard>
</template>
