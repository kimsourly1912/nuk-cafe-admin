<script setup lang="ts">
import type { SetupRow } from '../utils/setup'
import { requiredLeft } from '../utils/setup'

/**
 * "Set up your cafe" (D155): the steps a new cafe takes, each with a link to where it's done. What's
 * left to do comes first (required before optional), then what's done with a link to manage it. Hide
 * is offered once only optional steps are left: a cafe that won't use Telegram or KHQR isn't asked
 * about them forever.
 */
const props = defineProps<{
  rows: SetupRow[]
  /** Whether Hide is offered (no required step left). */
  hideable: boolean
}>()
const emit = defineEmits<{ hide: [] }>()

const tenantPath = useTenantPath()
const todo = computed(() => props.rows.filter(row => row.state !== 'done'))
const finished = computed(() => props.rows.filter(row => row.state === 'done'))
const essentialsLeft = computed(() => requiredLeft(props.rows))
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="setup-title"
    :ui="{ header: 'flex items-start justify-between gap-3', body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <div class="min-w-0 flex-1 space-y-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2
            id="setup-title"
            class="font-semibold text-highlighted"
          >
            Set up your cafe
          </h2>
          <UBadge
            v-if="!essentialsLeft"
            label="Essentials complete"
            icon="i-lucide-circle-check"
            color="success"
            variant="subtle"
          />
        </div>
        <p class="text-sm text-muted">
          {{ finished.length }} of {{ rows.length }} done
        </p>
        <UProgress
          :model-value="finished.length"
          :max="rows.length"
          size="sm"
          :aria-label="`${finished.length} of ${rows.length} setup steps done`"
        />
      </div>
      <UButton
        v-if="hideable"
        label="Hide checklist"
        trailing-icon="i-lucide-chevron-up"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="emit('hide')"
      />
    </template>

    <div class="divide-y divide-default">
      <section
        v-if="todo.length"
        aria-labelledby="setup-todo-title"
      >
        <h3
          id="setup-todo-title"
          class="px-4 pt-3 text-sm font-semibold text-highlighted sm:px-6"
        >
          {{ essentialsLeft ? 'To do first' : 'Recommended' }}
        </h3>
        <ul class="divide-y divide-default">
          <li
            v-for="row in todo"
            :key="row.step.id"
            class="flex items-center gap-3 px-4 py-3 sm:px-6"
          >
            <UIcon
              :name="row.state === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-circle'"
              class="size-5 shrink-0"
              :class="row.state === 'failed' ? 'text-warning' : 'text-dimmed'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-highlighted">
                <span class="sr-only">{{ row.state === 'failed' ? 'Couldn\'t check: ' : 'To do: ' }}</span>{{ row.step.label }}
                <UBadge
                  v-if="row.step.optional"
                  label="Optional"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  class="ms-1 align-middle"
                />
              </p>
              <p class="text-sm text-muted">
                {{ row.state === 'failed' ? 'Couldn\'t check this one. Open it to see.' : row.step.description }}
              </p>
            </div>
            <UButton
              :to="tenantPath(row.step.page)"
              label="Open"
              :aria-label="`Open: ${row.step.label}`"
              color="primary"
              variant="soft"
              size="sm"
              trailing-icon="i-lucide-chevron-right"
            />
          </li>
        </ul>
      </section>

      <section
        v-if="finished.length"
        aria-labelledby="setup-done-title"
      >
        <h3
          id="setup-done-title"
          class="px-4 pt-3 text-sm font-semibold text-highlighted sm:px-6"
        >
          Completed
        </h3>
        <ul class="divide-y divide-default">
          <li
            v-for="row in finished"
            :key="row.step.id"
            class="flex items-center gap-3 px-4 py-2 sm:px-6"
          >
            <UIcon
              name="i-lucide-circle-check"
              class="size-5 shrink-0 text-success"
            />
            <p class="min-w-0 flex-1 text-sm text-default">
              <span class="sr-only">Done: </span>{{ row.step.label }}
            </p>
            <UButton
              :to="tenantPath(row.step.page)"
              label="Manage"
              :aria-label="`Manage: ${row.step.label}`"
              color="neutral"
              variant="ghost"
              size="sm"
              trailing-icon="i-lucide-chevron-right"
            />
          </li>
        </ul>
      </section>
    </div>
  </UCard>
</template>
