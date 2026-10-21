<script setup lang="ts">
/**
 * System health (`/platform/health`, step P4, D192): the platform's machinery, read-only. Scheduled
 * jobs, unsent outbox messages per kind and cafe, failing Telegram deliveries per cafe and each
 * cafe's Bakong token expiry. Counts and dates only: never a secret, a message or an error's text.
 * Each cafe links to its page. A snapshot: Refresh (in the body, so the scrolling body always has
 * something to focus) reads it again.
 */
import { TELEGRAM_HEALTH_DAYS } from '#shared/contracts/platform-health'
import { usePlatformHealth } from '../composables/useActivity'
import { CAFES_PATH } from '../composables/usePlatformSession'
import { BAKONG_STATES, JOB_LABELS, lastAt, JOB_STATES, outboxKindLabel, scheduleLabel } from '../schemas/health'

const { data: health, loading, refreshing, error, refresh } = usePlatformHealth()
const cafePath = (id: string) => `${CAFES_PATH}/${id}`

/** Short lines naming what is wrong now, for the alert at the top. */
const problems = computed(() => {
  const value = health.value
  if (!value) return []
  const failingJobs = value.jobs.filter(job => job.state === 'failing').length
  const expired = value.bakong.filter(token => token.state === 'expired').length
  return [
    failingJobs && `${failingJobs} scheduled ${failingJobs === 1 ? 'job is' : 'jobs are'} failing`,
    value.outbox.dead && `${value.outbox.dead} outbox ${value.outbox.dead === 1 ? 'message was' : 'messages were'} given up on`,
    value.telegram.length && `${value.telegram.length} ${value.telegram.length === 1 ? 'cafe has' : 'cafes have'} failing Telegram messages`,
    expired && `${expired} Bakong ${expired === 1 ? 'token has' : 'tokens have'} expired`,
  ].filter((line): line is string => !!line)
})
</script>

<template>
  <UDashboardPanel id="health">
    <template #header>
      <UDashboardNavbar title="System health">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the system's health"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading || !health"
        label="Loading the system's health…"
        variant="row"
      />

      <div
        v-else
        class="space-y-6"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm text-muted">
            Checked {{ lastAt(health.checkedAt) }}
          </p>
          <UButton
            label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="refreshing"
            @click="refresh()"
          />
        </div>
        <UAlert
          v-if="problems.length"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Needs a look"
          :description="problems.join('. ') + '.'"
          data-testid="health-problems"
        />
        <UAlert
          v-else
          color="success"
          variant="subtle"
          icon="i-lucide-circle-check"
          title="Nothing is failing"
        />

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Scheduled jobs
            </h2>
            <p class="text-sm text-muted">
              While a job keeps succeeding, its last success is kept to within 5 minutes.
            </p>
          </template>
          <ul
            class="divide-y divide-default text-sm"
            aria-label="Scheduled jobs"
          >
            <li
              v-for="job in health.jobs"
              :key="job.job"
              class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <div class="min-w-0 basis-60">
                <p class="font-medium text-highlighted">
                  {{ JOB_LABELS[job.job] ?? job.job }}
                </p>
                <p class="text-muted">
                  <code>{{ job.job }}</code> · {{ scheduleLabel(job.schedule) }}
                </p>
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-muted">
                <span>Last success: {{ lastAt(job.lastSuccessAt) }}</span>
                <span v-if="job.lastFailureAt">Last failure: {{ lastAt(job.lastFailureAt) }}</span>
                <span v-if="job.failuresInARow">{{ job.failuresInARow }} in a row</span>
                <UBadge
                  :color="JOB_STATES[job.state].color"
                  variant="subtle"
                >
                  {{ JOB_STATES[job.state].label }}
                </UBadge>
              </div>
            </li>
          </ul>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Outbox
            </h2>
            <p class="text-sm text-muted">
              Messages and emails waiting to go out, retried after a failure, or given up on.
            </p>
          </template>
          <div class="space-y-4">
            <dl class="grid grid-cols-3 gap-3">
              <StatCard
                label="Waiting"
                :value="String(health.outbox.waiting)"
              />
              <StatCard
                label="Retrying"
                :value="String(health.outbox.failing)"
              />
              <StatCard
                label="Given up"
                :value="String(health.outbox.dead)"
              />
            </dl>
            <ul
              v-if="health.outbox.groups.length"
              class="divide-y divide-default text-sm"
              aria-label="Outbox by kind and cafe"
            >
              <li
                v-for="group in health.outbox.groups"
                :key="`${group.kind}:${group.cafe?.id ?? 'platform'}`"
                class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <div class="min-w-0">
                  <p class="font-medium text-highlighted">
                    {{ outboxKindLabel(group.kind) }}
                  </p>
                  <p class="text-muted">
                    <NuxtLink
                      v-if="group.cafe"
                      :to="cafePath(group.cafe.id)"
                      class="underline"
                    >{{ group.cafe.name }}</NuxtLink>
                    <template v-else>
                      The platform
                    </template>
                    · oldest {{ lastAt(group.oldestAt) }}
                  </p>
                </div>
                <p class="text-muted tabular-nums">
                  {{ group.waiting }} waiting · {{ group.failing }} retrying ·
                  <span :class="group.dead ? 'font-medium text-error' : ''">{{ group.dead }} given up</span>
                </p>
              </li>
            </ul>
            <p
              v-else
              class="text-sm text-muted"
            >
              Everything has been sent.
            </p>
          </div>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Telegram
            </h2>
            <p class="text-sm text-muted">
              Cafes whose Telegram messages failed in the last {{ TELEGRAM_HEALTH_DAYS }} days.
            </p>
          </template>
          <ul
            v-if="health.telegram.length"
            class="divide-y divide-default text-sm"
            aria-label="Failing Telegram messages by cafe"
          >
            <li
              v-for="row in health.telegram"
              :key="row.cafe.id"
              class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <NuxtLink
                :to="cafePath(row.cafe.id)"
                class="font-medium text-highlighted underline"
              >
                {{ row.cafe.name }}
              </NuxtLink>
              <p class="text-muted tabular-nums">
                {{ row.failed }} given up · {{ row.retrying }} retrying · newest {{ lastAt(row.newestFailingAt) }}
              </p>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            No cafe's Telegram messages are failing.
          </p>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Bakong tokens
            </h2>
            <p class="text-sm text-muted">
              Each cafe's own token checks KHQR payments. Only its expiry date is shown, never the token.
            </p>
          </template>
          <ul
            v-if="health.bakong.length"
            class="divide-y divide-default text-sm"
            aria-label="Bakong tokens by cafe"
          >
            <li
              v-for="token in health.bakong"
              :key="token.cafe.id"
              class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <NuxtLink
                :to="cafePath(token.cafe.id)"
                class="font-medium text-highlighted underline"
              >
                {{ token.cafe.name }}
              </NuxtLink>
              <div class="flex items-center gap-3 text-muted">
                <span>{{ token.expiresAt ? `Expires ${formatDate(token.expiresAt)}` : 'No expiry in the token' }}</span>
                <UBadge
                  :color="BAKONG_STATES[token.state].color"
                  variant="subtle"
                >
                  {{ BAKONG_STATES[token.state].label }}
                </UBadge>
              </div>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            No cafe has saved a Bakong token.
          </p>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
