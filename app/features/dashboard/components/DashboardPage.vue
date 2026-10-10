<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { useAuth } from '~/features/auth'
import { useSetupChecklist, useToday } from '../composables/useDashboard'
import { requiredLeft } from '../utils/setup'
import SetupChecklist from './SetupChecklist.vue'

/**
 * The admin's home (D155): today in each branch (the Reports summary: paid sales against yesterday,
 * orders, what waits for payment or is being made), "Set up your cafe" while there's something left
 * to do, and shortcuts to the daily tasks. Read only: every number links to the page behind it.
 */
const { user } = useAuth()
const tenantPath = useTenantPath()
const slug = useTenantSlug()

const today = useToday()
const setup = useSetupChecklist()

// Hiding the optional steps is this person's choice on this browser (nothing else depends on it).
const hidden = useLocalStorage(() => `nuk:setup-hidden:${slug.value}:${user.value?.userId ?? ''}`, false)
const rows = computed(() => setup.data.value ?? [])
const mustFinish = computed(() => requiredLeft(rows.value))
const showSetup = computed(() => rows.value.some(row => row.state !== 'done') && (mustFinish.value || !hidden.value))

const several = computed(() => (today.data.value?.length ?? 0) > 1)
const firstBranch = computed(() => today.data.value?.[0]?.branch)

const greeting = computed(() => {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const name = user.value?.name?.split(' ')[0]
  return name ? `${part}, ${name}` : part
})

const summaryLink = (branchId: string, date: string) =>
  tenantPath(`/admin/reports/summary?branch=${encodeURIComponent(branchId)}&from=${date}&to=${date}`)
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <p class="text-lg font-medium text-highlighted">
          {{ greeting }}
        </p>

        <!-- Required steps left: setup comes first. -->
        <SetupChecklist
          v-if="showSetup && mustFinish"
          :rows="rows"
          :hideable="false"
        />

        <ApiErrorAlert
          v-if="today.error.value && !today.data.value"
          :error="today.error.value"
          title="Couldn't load today's numbers"
          @retry="today.refresh()"
        />
        <ListSkeleton
          v-else-if="today.loading.value"
          label="Loading today…"
          variant="row"
          :count="2"
        />
        <section
          v-for="entry in today.data.value ?? []"
          :key="entry.branch.id"
          :aria-labelledby="`today-${entry.branch.id}`"
          class="space-y-3"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2
              :id="`today-${entry.branch.id}`"
              class="font-semibold text-highlighted"
            >
              Today{{ several ? ` at ${entry.branch.name}` : '' }}
            </h2>
            <div class="flex gap-1">
              <UButton
                :to="summaryLink(entry.branch.id, entry.branch.today)"
                label="Summary"
                icon="i-lucide-chart-column"
                color="neutral"
                variant="ghost"
                size="sm"
              />
              <UButton
                :to="tenantPath(`/counter/${entry.branch.id}`)"
                target="_blank"
                label="Counter"
                icon="i-lucide-monitor"
                color="neutral"
                variant="ghost"
                size="sm"
              />
            </div>
          </div>
          <ApiErrorAlert
            v-if="entry.error"
            :error="entry.error"
            title="Couldn't load today's numbers"
            @retry="today.refresh()"
          />
          <dl
            v-else-if="entry.summary"
            class="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <StatCard
              label="Paid sales"
              :value="formatMinor(entry.summary.paid.salesMinor)"
              :change="changeText(entry.summary.paid.salesMinor, entry.summary.previousPaidSalesMinor) ?? undefined"
              change-label="vs yesterday"
            />
            <StatCard
              label="Orders"
              :value="entry.summary.ordersPlaced.toLocaleString('en-US')"
            />
            <StatCard
              label="Waiting for payment"
              :value="String(entry.summary.current?.awaitingPayment ?? 0)"
            />
            <StatCard
              label="Preparing or ready"
              :value="String((entry.summary.current?.preparing ?? 0) + (entry.summary.current?.ready ?? 0))"
            />
          </dl>
        </section>

        <SetupChecklist
          v-if="showSetup && !mustFinish"
          :rows="rows"
          :hideable="true"
          @hide="hidden = true"
        />

        <section
          aria-labelledby="shortcuts-title"
          class="space-y-3"
        >
          <h2
            id="shortcuts-title"
            class="font-semibold text-highlighted"
          >
            Shortcuts
          </h2>
          <div class="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            <UButton
              :to="tenantPath('/admin/products/new')"
              label="New menu item"
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
            />
            <UButton
              v-if="firstBranch"
              :to="tenantPath(`/counter/${firstBranch.id}/sold-out`)"
              target="_blank"
              label="Sold out"
              icon="i-lucide-circle-slash"
              color="neutral"
              variant="outline"
            />
            <UButton
              :to="tenantPath('/admin/reports')"
              label="Reports"
              icon="i-lucide-chart-column"
              color="neutral"
              variant="outline"
            />
            <UButton
              :to="tenantPath('/')"
              target="_blank"
              label="View menu"
              icon="i-lucide-external-link"
              color="neutral"
              variant="outline"
            />
          </div>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
