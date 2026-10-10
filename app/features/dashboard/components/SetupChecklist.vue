<script setup lang="ts">
import type { SetupRow } from '../utils/setup'

/**
 * "Set up your cafe" (D155): the steps a new cafe takes, each with a link to where it's done. Steps
 * to do first, then the optional ones, then what's done. Hide is offered once only optional steps
 * are left: a cafe that won't use Telegram or KHQR isn't asked about them forever.
 */
const props = defineProps<{
  rows: SetupRow[]
  /** Whether Hide is offered (no required step left). */
  hideable: boolean
}>()
const emit = defineEmits<{ hide: [] }>()

const tenantPath = useTenantPath()
const done = computed(() => props.rows.filter(row => row.state === 'done').length)
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="setup-title"
    :ui="{ header: 'flex items-start justify-between gap-3', body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <div class="min-w-0 flex-1 space-y-2">
        <h2
          id="setup-title"
          class="font-semibold text-highlighted"
        >
          Set up your cafe
        </h2>
        <p class="text-sm text-muted">
          {{ done }} of {{ rows.length }} done
        </p>
        <UProgress
          :model-value="done"
          :max="rows.length"
          size="sm"
          :aria-label="`${done} of ${rows.length} setup steps done`"
        />
      </div>
      <UButton
        v-if="hideable"
        label="Hide"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="emit('hide')"
      />
    </template>

    <ul class="divide-y divide-default">
      <li
        v-for="row in rows"
        :key="row.step.id"
        class="flex items-center gap-3 px-4 py-3 sm:px-6"
      >
        <UIcon
          :name="row.state === 'done' ? 'i-lucide-circle-check' : row.state === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-circle'"
          class="size-5 shrink-0"
          :class="row.state === 'done' ? 'text-success' : row.state === 'failed' ? 'text-warning' : 'text-dimmed'"
        />
        <div class="min-w-0 flex-1">
          <p
            class="text-sm font-medium"
            :class="row.state === 'done' ? 'text-muted line-through' : 'text-highlighted'"
          >
            <span class="sr-only">{{ row.state === 'done' ? 'Done: ' : row.state === 'failed' ? 'Couldn\'t check: ' : 'To do: ' }}</span>{{ row.step.label }}
            <UBadge
              v-if="row.step.optional && row.state !== 'done'"
              label="Optional"
              color="neutral"
              variant="subtle"
              size="sm"
              class="ms-1 align-middle"
            />
          </p>
          <p
            v-if="row.state !== 'done'"
            class="text-sm text-muted"
          >
            {{ row.state === 'failed' ? 'Couldn\'t check this one. Open it to see.' : row.step.description }}
          </p>
        </div>
        <UButton
          v-if="row.state !== 'done'"
          :to="tenantPath(row.step.page)"
          label="Open"
          :aria-label="`Open: ${row.step.label}`"
          color="neutral"
          variant="outline"
          size="sm"
          trailing-icon="i-lucide-chevron-right"
        />
      </li>
    </ul>
  </UCard>
</template>
