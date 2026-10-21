<script setup lang="ts">
/**
 * Platform support (`/admin/support`, step P5, D193): the owner allows the platform team to look at
 * this cafe's admin for 24 hours, read-only, and can end it at any time. Below, every grant with
 * who looked and when: the cafe's own record (the audit history has each page they opened).
 */
import type { SupportGrant } from '#shared/contracts/support'
import { SUPPORT_GRANT_HOURS } from '#shared/contracts/support'
import { useAuth } from '~/features/auth'
import { useCafeSupport, useCafeSupportMutations } from '../composables/useCafeSupport'

const { data, loading, error, refresh } = useCafeSupport()
const { allow, end, endVisit, busy } = useCafeSupportMutations()
const { fetchSession } = useAuth()

const nameOf = (person: { name: string | null }) => person.name ?? 'Someone from the platform team'

/** The sidebar's banner follows (the session carries until when support is allowed). */
async function allowNow() {
  if ((await allow.execute({})).ok) await fetchSession()
}
async function endNow(grant: SupportGrant) {
  if ((await end.execute(grant.id)).ok) await fetchSession()
}

function statusOf(grant: SupportGrant) {
  if (grant.active) return { label: 'Active', color: 'success' as const }
  return grant.endedAt ? { label: 'Ended', color: 'neutral' as const } : { label: 'Expired', color: 'neutral' as const }
}
</script>

<template>
  <UDashboardPanel
    id="support"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar title="Platform support">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load platform support"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading || !data"
        label="Loading platform support…"
        variant="row"
      />

      <div
        v-else
        class="space-y-6"
      >
        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Allow the platform team to look
            </h2>
          </template>
          <div
            v-if="data.active"
            class="space-y-4"
          >
            <UAlert
              color="success"
              variant="subtle"
              icon="i-lucide-life-buoy"
              title="Platform support is allowed"
              :description="`Until ${formatDateTime(data.active.expiresAt)}. Allowed by ${nameOf(data.active.grantedBy)} on ${formatDateTime(data.active.grantedAt)}.`"
              data-testid="support-active"
            />
            <UButton
              label="End now"
              icon="i-lucide-circle-stop"
              color="error"
              variant="outline"
              :loading="end.isPending()"
              :disabled="busy"
              @click="endNow(data.active)"
            />
          </div>
          <div
            v-else
            class="space-y-4 text-sm"
          >
            <p>
              When you need help, allow the platform team to look at this cafe's admin for {{ SUPPORT_GRANT_HOURS }} hours.
              They can see the menu, orders, reports, staff and settings, but they can't change anything,
              download reports or use the assistant. It ends by itself, or when you end it.
            </p>
            <UButton
              :label="`Allow for ${SUPPORT_GRANT_HOURS} hours`"
              icon="i-lucide-life-buoy"
              :loading="allow.isPending()"
              :disabled="busy"
              @click="allowNow()"
            />
          </div>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              History
            </h2>
            <p class="text-sm text-muted">
              Each time support was allowed, and who from the platform team looked.
            </p>
          </template>
          <ul
            v-if="data.history.length"
            class="divide-y divide-default text-sm"
            aria-label="Support history"
          >
            <li
              v-for="grant in data.history"
              :key="grant.id"
              class="space-y-2 py-3 first:pt-0 last:pb-0"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-highlighted">{{ formatDateTime(grant.grantedAt) }}</span>
                <UBadge
                  :color="statusOf(grant).color"
                  variant="subtle"
                >
                  {{ statusOf(grant).label }}
                </UBadge>
              </div>
              <p class="text-muted">
                Allowed by {{ nameOf(grant.grantedBy) }}
                <template v-if="grant.endedAt">
                  · ended {{ formatDateTime(grant.endedAt) }}{{ grant.endedBy ? ` by ${nameOf(grant.endedBy)}` : '' }}
                </template>
                <template v-else-if="!grant.active">
                  · expired {{ formatDateTime(grant.expiresAt) }}
                </template>
              </p>
              <ul
                v-if="grant.visits.length"
                class="space-y-1 ps-4"
                :aria-label="`Who looked, from ${formatDateTime(grant.grantedAt)}`"
              >
                <li
                  v-for="visit in grant.visits"
                  :key="visit.id"
                  class="list-disc"
                >
                  <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      {{ nameOf(visit.by) }} opened it {{ formatDateTime(visit.openedAt) }}<template v-if="visit.closedAt"> · closed {{ formatDateTime(visit.closedAt) }}</template>
                    </span>
                    <template v-if="visit.active">
                      <UBadge
                        color="success"
                        variant="subtle"
                      >
                        Looking now
                      </UBadge>
                      <UButton
                        label="End visit"
                        icon="i-lucide-circle-stop"
                        size="xs"
                        color="error"
                        variant="outline"
                        :loading="endVisit.isPending(visit.id)"
                        :disabled="busy"
                        @click="endVisit.execute(visit)"
                      />
                    </template>
                  </span>
                </li>
              </ul>
              <p
                v-else
                class="text-muted"
              >
                Nobody from the platform team looked.
              </p>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            Platform support has never been allowed.
          </p>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
