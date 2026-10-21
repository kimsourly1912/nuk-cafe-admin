<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { useAuth } from '~/features/auth'
import { useSetupChecklist, useToday } from '../composables/useDashboard'
import { requiredLeft } from '../utils/setup'
import SetupChecklist from './SetupChecklist.vue'
import TodaySkeleton from './TodaySkeleton.vue'

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
  <!-- A gray page with white cards on it (owner, D155 follow-up): the cards read against the ground. -->
  <UDashboardPanel
    id="overview"
    :ui="{ body: 'bg-elevated dark:bg-muted' }"
  >
    <template #header>
      <UDashboardNavbar title="Overview">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            :to="tenantPath('/')"
            target="_blank"
            label="View menu"
            trailing-icon="i-lucide-external-link"
            color="neutral"
            variant="outline"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <div>
          <p class="text-2xl font-semibold text-highlighted">
            {{ greeting }}
          </p>
          <p class="text-sm text-toned">
            Here is what is happening at your cafe today.
          </p>
        </div>

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
        <TodaySkeleton
          v-else-if="today.loading.value"
          label="Loading today…"
        />
        <UCard
          v-for="entry in today.data.value ?? []"
          :key="entry.branch.id"
          as="section"
          :aria-labelledby="`today-${entry.branch.id}`"
          :ui="{ header: 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2' }"
        >
          <template #header>
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
                variant="outline"
                size="sm"
              />
              <UButton
                :to="tenantPath(`/counter/${entry.branch.id}`)"
                target="_blank"
                label="Open counter"
                icon="i-lucide-monitor"
                color="neutral"
                variant="outline"
                size="sm"
              />
            </div>
          </template>
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
              icon="i-lucide-banknote"
              :value="formatMinor(entry.summary.paid.salesMinor)"
              :change="changeText(entry.summary.paid.salesMinor, entry.summary.previousPaidSalesMinor) ?? undefined"
              change-label="vs yesterday"
            />
            <StatCard
              label="Orders"
              icon="i-lucide-shopping-cart"
              :value="entry.summary.ordersPlaced.toLocaleString('en-US')"
            />
            <StatCard
              label="Waiting for payment"
              icon="i-lucide-clock"
              :value="String(entry.summary.current?.awaitingPayment ?? 0)"
            />
            <StatCard
              label="Preparing or ready"
              icon="i-lucide-chef-hat"
              :value="String((entry.summary.current?.preparing ?? 0) + (entry.summary.current?.ready ?? 0))"
            />
          </dl>
        </UCard>

        <SetupChecklist
          v-if="showSetup && !mustFinish"
          :rows="rows"
          :hideable="true"
          @hide="hidden = true"
        />

        <UCard
          as="section"
          aria-labelledby="shortcuts-title"
        >
          <template #header>
            <h2
              id="shortcuts-title"
              class="font-semibold text-highlighted"
            >
              Shortcuts
            </h2>
          </template>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <UPageCard
              :to="tenantPath('/admin/products/new')"
              title="New menu item"
              description="Add an item to your menu"
              icon="i-lucide-file-plus"
              variant="outline"
            />
            <UPageCard
              v-if="firstBranch"
              :to="tenantPath(`/counter/${firstBranch.id}/sold-out`)"
              target="_blank"
              title="Sold out"
              description="Mark items as sold out"
              icon="i-lucide-circle-slash"
              variant="outline"
            />
            <UPageCard
              :to="tenantPath('/admin/reports')"
              title="Reports"
              description="View sales and orders"
              icon="i-lucide-chart-column"
              variant="outline"
            />
            <UPageCard
              :to="tenantPath('/')"
              target="_blank"
              title="View menu"
              description="See your customer menu"
              icon="i-lucide-external-link"
              variant="outline"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
