<script setup lang="ts">
/**
 * One cafe in the platform console (`/platform/cafes/:id`, D142): how much it's used, where it
 * lives, who owns it, and the platform's actions on it (change the address, pause, resume; add,
 * remove and transfer owners, P2, D189), with the platform team's internal notes. A super admin
 * never sees the cafe's menu, orders or customers (D134): its owners run it in the cafe's own admin.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import { formatPhone } from '#shared/contracts/phone'
import type { TenantOwner } from '#shared/contracts/tenants'
import { CAFES_PATH, usePlatformSession } from '../composables/usePlatformSession'
import { accountPath } from '../composables/useAccounts'
import { cafeActivityPath, useCafeActivity } from '../composables/useActivity'
import { ACTION_LABELS, activitySubject, actorName } from '../schemas/activity'
import { newCafePath, useCafe, useCafeMutations } from '../composables/useCafes'
import { timeAgo } from '../schemas/cafe-form'
import { othersCanSignIn } from '../schemas/owner-form'
import CafeAddressModal from './CafeAddressModal.vue'
import CafeNotesModal from './CafeNotesModal.vue'
import CafeOwnerModal from './CafeOwnerModal.vue'
import CafeOwnerRemoveModal from './CafeOwnerRemoveModal.vue'
import CafeSupportOpenModal from './CafeSupportOpenModal.vue'
import CafeSuspendModal from './CafeSuspendModal.vue'

const props = defineProps<{ id: string }>()

const { data: cafe, loading, error, refresh } = useCafe(props.id)
const { resume, updateNotes, isBusy } = useCafeMutations()
const busy = computed(() => isBusy(props.id))
const notFound = computed(() => error.value?.status === 404)
const paused = computed(() => cafe.value?.status === 'suspended')

const overlay = useOverlay()
const addressModal = overlay.create(CafeAddressModal)
const suspendModal = overlay.create(CafeSuspendModal)
const ownerModal = overlay.create(CafeOwnerModal)
const removeModal = overlay.create(CafeOwnerRemoveModal)
const notesModal = overlay.create(CafeNotesModal)
const supportModal = overlay.create(CafeSupportOpenModal)

const { user } = usePlatformSession()
const activity = useCafeActivity(props.id)
/** One's own ownership is changed by another super admin (D189). */
const isOwn = (owner: TenantOwner) => owner.id === user.value?.userId

function ownerActions(owner: TenantOwner): DropdownMenuItem[] {
  const own = isOwn(owner)
  const lastActive = !othersCanSignIn(cafe.value!, owner)
  return [
    { label: 'Open account', icon: 'i-lucide-user', to: accountPath(owner.id) },
    {
      label: 'Transfer ownership',
      icon: 'i-lucide-arrow-right-left',
      disabled: own || busy.value,
      description: own ? 'Ask another super admin' : undefined,
      onSelect: () => ownerModal.open({ cafe: cafe.value!, from: owner }),
    },
    {
      label: 'Remove owner',
      icon: 'i-lucide-user-minus',
      color: 'error',
      disabled: own || lastActive || busy.value,
      description: own ? 'Ask another super admin' : lastActive ? 'No other owner can sign in: transfer instead' : undefined,
      onSelect: () => removeModal.open({ cafe: cafe.value!, owner }),
    },
  ]
}

const created = computed(() => cafe.value && formatDate(cafe.value.createdAt))
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
            :to="CAFES_PATH"
            aria-label="Back to Cafes"
            class="lg:hidden"
          />
        </template>
        <template #title>
          <UBreadcrumb
            :items="[{ label: 'Cafes', to: CAFES_PATH }, { label: cafe?.name ?? 'Cafe' }]"
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
          :to="CAFES_PATH"
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

        <UAlert
          v-if="cafe.activeOwners === 0"
          color="warning"
          variant="subtle"
          icon="i-lucide-user-x"
          title="No active owner"
          description="The cafe keeps taking orders, but nobody can change its menu, staff or payments until an owner can sign in. Add an owner, or transfer a banned owner's ownership."
          :actions="[{ label: 'Add owner', color: 'warning', variant: 'solid', disabled: busy, onClick: () => { void ownerModal.open({ cafe: cafe! }) } }]"
          data-testid="no-active-owner"
        />

        <UCard variant="outline">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold text-highlighted">
                Owners
              </h2>
              <UButton
                label="Add owner"
                icon="i-lucide-user-plus"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="busy"
                @click="ownerModal.open({ cafe })"
              />
            </div>
          </template>
          <ul
            v-if="cafe.owners.length"
            class="divide-y divide-default"
            aria-label="Owners"
          >
            <li
              v-for="owner in cafe.owners"
              :key="owner.id"
              class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 first:pt-0 last:pb-0"
            >
              <div class="flex min-w-0 flex-1 basis-56 flex-col">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-highlighted">{{ owner.name }}</span>
                  <UBadge
                    v-if="owner.banned"
                    color="error"
                    variant="subtle"
                    size="sm"
                  >
                    Banned
                  </UBadge>
                  <UBadge
                    v-if="owner.staffAccess"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                  >
                    Also branch staff
                  </UBadge>
                </span>
                <span class="truncate text-sm text-muted">{{ owner.email }}</span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <UButton
                  label="New cafe for this owner"
                  icon="i-lucide-plus"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :aria-label="`New cafe for this owner: ${owner.name}`"
                  :to="newCafePath(owner.id)"
                />
                <UDropdownMenu
                  :items="ownerActions(owner)"
                  :content="{ align: 'end' }"
                >
                  <UButton
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :aria-label="`Actions for ${owner.name}`"
                  />
                </UDropdownMenu>
              </div>
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

        <UCard variant="outline">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div>
                <h2 class="font-semibold text-highlighted">
                  Internal notes
                </h2>
                <p class="text-sm text-muted">
                  For the platform team: never shown to the cafe.
                </p>
              </div>
              <UButton
                label="Edit"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                size="sm"
                aria-label="Edit internal notes"
                :disabled="updateNotes.isPending(cafe.id)"
                @click="notesModal.open({ cafe })"
              />
            </div>
          </template>
          <div
            v-if="cafe.notes.version"
            class="space-y-3 text-sm"
          >
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt class="text-muted">
                  Contact person
                </dt>
                <dd class="text-highlighted">
                  {{ cafe.notes.contactName ?? 'Not set' }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">
                  Phone
                </dt>
                <dd class="text-highlighted">
                  <a
                    v-if="cafe.notes.contactPhone"
                    :href="`tel:${cafe.notes.contactPhone}`"
                    class="underline"
                  >{{ formatPhone(cafe.notes.contactPhone) }}</a>
                  <template v-else>
                    Not set
                  </template>
                </dd>
              </div>
              <div
                v-if="cafe.notes.notes"
                class="sm:col-span-2"
              >
                <dt class="text-muted">
                  Notes
                </dt>
                <dd class="whitespace-pre-line break-words text-highlighted">
                  {{ cafe.notes.notes }}
                </dd>
              </div>
            </dl>
            <p
              v-if="cafe.notes.updatedAt"
              class="text-muted"
            >
              Updated {{ timeAgo(cafe.notes.updatedAt) }}
            </p>
          </div>
          <p
            v-else
            class="text-sm text-muted"
          >
            No notes yet: add a contact person, their phone or anything the team should know.
          </p>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Support access
            </h2>
          </template>
          <div
            v-if="cafe.support"
            class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p class="text-sm">
              The owner allows platform support until {{ formatShortDateTime(cafe.support.expiresAt) }}: read-only, for up to an hour per visit.
            </p>
            <UButton
              label="Open read-only"
              icon="i-lucide-life-buoy"
              class="shrink-0"
              :disabled="paused"
              @click="supportModal.open({ cafe })"
            />
          </div>
          <p
            v-else
            class="text-sm text-muted"
          >
            The owner hasn't allowed platform support. When they need help, they allow it for 24 hours in their admin under Platform support; nobody on the platform team can open the cafe without it.
          </p>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold text-highlighted">
                Platform activity
              </h2>
              <UButton
                label="See all"
                :to="cafeActivityPath(cafe.id)"
                color="neutral"
                variant="outline"
                size="sm"
                aria-label="See all the platform's activity on this cafe"
              />
            </div>
          </template>
          <ApiErrorAlert
            v-if="activity.error.value"
            :error="activity.error.value"
            title="Could not load the activity"
            @retry="activity.refresh()"
          />
          <ul
            v-else-if="activity.data.value?.items.length"
            class="divide-y divide-default text-sm"
            aria-label="Platform activity"
          >
            <li
              v-for="entry in activity.data.value.items"
              :key="entry.id"
              class="py-2 first:pt-0 last:pb-0"
            >
              <p class="font-medium text-highlighted">
                {{ ACTION_LABELS[entry.action] }}
                <span
                  v-if="activitySubject(entry)"
                  class="font-normal text-default"
                >: {{ activitySubject(entry) }}</span>
              </p>
              <p
                v-if="entry.details.reason"
                class="break-words text-muted"
              >
                Reason: {{ entry.details.reason }}
              </p>
              <p class="text-muted">
                {{ actorName(entry) }} · {{ timeAgo(entry.at) }}
              </p>
            </li>
          </ul>
          <p
            v-else-if="!activity.loading.value"
            class="text-sm text-muted"
          >
            The platform team hasn't acted on this cafe yet.
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
