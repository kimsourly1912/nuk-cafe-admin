<script setup lang="ts">
/**
 * One cafe in the platform console (`/platform/cafes/:id`, D142): how much it's used, where it
 * lives, who owns it, and the platform's actions on it (change the address, pause, resume). A
 * super admin never sees the cafe's menu, orders or customers (D134): its owners run it in the
 * cafe's own admin.
 */
import { useCafe, useCafeMutations } from '../composables/useCafes'
import { timeAgo } from '../schemas/cafe-form'
import CafeAddressModal from './CafeAddressModal.vue'
import CafeSuspendModal from './CafeSuspendModal.vue'

const props = defineProps<{ id: string }>()

const { data: cafe, loading, error, refresh } = useCafe(props.id)
const { resume, isBusy } = useCafeMutations()
const busy = computed(() => isBusy(props.id))
const notFound = computed(() => error.value?.status === 404)
const paused = computed(() => cafe.value?.status === 'suspended')

const overlay = useOverlay()
const addressModal = overlay.create(CafeAddressModal)
const suspendModal = overlay.create(CafeSuspendModal)

const created = computed(() => cafe.value && new Date(cafe.value.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))
</script>

<template>
  <UDashboardPanel
    id="cafe"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            to="/platform"
            aria-label="Back to Cafes"
            class="lg:hidden"
          />
        </template>
        <template #title>
          <UBreadcrumb
            :items="[{ label: 'Cafes', to: '/platform' }, { label: cafe?.name ?? 'Cafe' }]"
            class="hidden min-w-0 lg:flex"
          />
          <span class="truncate lg:hidden">{{ cafe?.name ?? 'Cafe' }}</span>
          <UBadge
            v-if="cafe"
            :color="paused ? 'warning' : 'success'"
            variant="subtle"
            class="ms-2"
          >
            {{ paused ? 'Paused' : 'Active' }}
          </UBadge>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="notFound"
        class="flex flex-col items-center gap-2 py-10 text-center"
      >
        <UIcon
          name="i-lucide-search-x"
          class="size-10 text-dimmed"
        />
        <p class="font-medium text-highlighted">
          This cafe doesn't exist
        </p>
        <p class="text-sm text-muted">
          The link may be wrong.
        </p>
        <UButton
          label="Back to Cafes"
          to="/platform"
          color="neutral"
          variant="outline"
          class="mt-2"
        />
      </div>

      <ApiErrorAlert
        v-else-if="error"
        :error="error"
        title="Could not load the cafe"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading || !cafe"
        label="Loading the cafe…"
        variant="row"
      />

      <div
        v-else
        class="space-y-6"
      >
        <UAlert
          v-if="paused"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-pause"
          title="This cafe is paused"
          :description="`Customers can't order and its staff can't use the admin or the counter. Reason: ${cafe.suspendedReason}`"
          :actions="[{ label: 'Resume cafe', color: 'warning', variant: 'solid', loading: resume.isPending(cafe.id), disabled: busy, onClick: () => { void resume.execute(cafe!) } }]"
        />

        <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Branches"
            :value="String(cafe.usage.branches)"
            icon="i-lucide-store"
          />
          <StatCard
            label="Staff"
            :value="String(cafe.usage.staff)"
            icon="i-lucide-users"
          />
          <StatCard
            label="Orders, last 30 days"
            :value="String(cafe.usage.ordersLast30Days)"
            icon="i-lucide-receipt"
          />
          <StatCard
            label="Last order"
            :value="cafe.usage.lastOrderAt ? timeAgo(cafe.usage.lastOrderAt) : 'None yet'"
            icon="i-lucide-clock"
          />
        </dl>

        <UCard variant="outline">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold text-highlighted">
                Web address
              </h2>
              <UButton
                label="Change"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="busy"
                @click="addressModal.open({ cafe })"
              />
            </div>
          </template>
          <div class="space-y-3 text-sm">
            <p>
              <a
                :href="tenantUrl(cafe.slug, '/')"
                target="_blank"
                class="font-medium text-primary underline"
              >/c/{{ cafe.slug }}</a>
              <span class="text-muted">: the menu; its admin and counter are under it.</span>
            </p>
            <div v-if="cafe.formerSlugs.length">
              <p class="text-muted">
                Earlier addresses, still sending people here:
              </p>
              <ul class="mt-1 flex flex-wrap gap-1">
                <li
                  v-for="slug in cafe.formerSlugs"
                  :key="slug"
                >
                  <UBadge
                    color="neutral"
                    variant="subtle"
                  >
                    /c/{{ slug }}
                  </UBadge>
                </li>
              </ul>
            </div>
          </div>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Owners
            </h2>
          </template>
          <ul
            v-if="cafe.owners.length"
            class="divide-y divide-default"
          >
            <li
              v-for="owner in cafe.owners"
              :key="owner.id"
              class="flex flex-col py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-2"
            >
              <span class="font-medium text-highlighted">{{ owner.name }}</span>
              <span class="truncate text-sm text-muted">{{ owner.email }}</span>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            No owner.
          </p>
          <p class="mt-3 text-sm text-muted">
            Owners manage the cafe's menu, staff and payments in its admin. Created {{ created }}.
          </p>
        </UCard>

        <UCard
          v-if="!paused"
          variant="outline"
          :ui="{ root: 'ring-error/40' }"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="font-semibold text-highlighted">
                Pause this cafe
              </h2>
              <p class="text-sm text-muted">
                Customers can't order and its staff can't use the admin or the counter until you resume it. Nothing is deleted.
              </p>
            </div>
            <UButton
              label="Pause cafe"
              icon="i-lucide-circle-pause"
              color="error"
              variant="outline"
              class="shrink-0"
              :disabled="busy"
              @click="suspendModal.open({ cafe })"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
