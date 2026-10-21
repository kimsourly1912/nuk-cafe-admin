<script setup lang="ts">
/**
 * One account in the platform console (`/platform/accounts/:id`, step P1, D187): who it is, the
 * cafes it works in, its sessions, and the platform's actions on it (ban or unban, sign out
 * everywhere, a temporary password). Never the cafes a customer orders from (D186). A super admin's
 * account and one's own are shown without actions: another super admin is changed by hand, one's
 * own through the account menu.
 */
import { usePlatformSession } from '../composables/usePlatformSession'
import { ACCOUNTS_PATH, useAccount, useAccountMutations } from '../composables/useAccounts'
import { banLine } from '../schemas/account-form'
import { timeAgo } from '../schemas/cafe-form'
import AccountBanModal from './AccountBanModal.vue'
import AccountPasswordModal from './AccountPasswordModal.vue'

const props = defineProps<{ id: string }>()

const { data: account, loading, error, refresh } = useAccount(props.id)
const { unban, signOut, isBusy } = useAccountMutations()
const { user } = usePlatformSession()
const busy = computed(() => isBusy(props.id))
const notFound = computed(() => error.value?.status === 404)
const own = computed(() => user.value?.userId === props.id)
/** Actions the console offers on this account: none on one's own or another super admin's. */
const changeable = computed(() => !!account.value && !own.value && !account.value.isSuperadmin)

const overlay = useOverlay()
const banModal = overlay.create(AccountBanModal)
const passwordModal = overlay.create(AccountPasswordModal)
</script>

<template>
  <UDashboardPanel
    id="account"
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
            :to="ACCOUNTS_PATH"
            aria-label="Back to Accounts"
            class="lg:hidden"
          />
        </template>
        <template #title>
          <UBreadcrumb
            :items="[{ label: 'Accounts', to: ACCOUNTS_PATH }, { label: account?.name ?? 'Account' }]"
            class="hidden min-w-0 lg:flex"
          />
          <span class="truncate lg:hidden">{{ account?.name ?? 'Account' }}</span>
          <UBadge
            v-if="account"
            :color="account.ban ? 'error' : 'success'"
            variant="subtle"
            class="ms-2"
          >
            {{ account.ban ? 'Banned' : 'Active' }}
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
          This account doesn't exist
        </p>
        <p class="text-sm text-muted">
          The link may be wrong.
        </p>
        <UButton
          label="Back to Accounts"
          :to="ACCOUNTS_PATH"
          color="neutral"
          variant="outline"
          class="mt-2"
        />
      </div>

      <ApiErrorAlert
        v-else-if="error"
        :error="error"
        title="Could not load the account"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading || !account"
        label="Loading the account…"
        variant="row"
      />

      <div
        v-else
        class="space-y-6"
      >
        <UAlert
          v-if="account.ban"
          color="error"
          variant="subtle"
          icon="i-lucide-ban"
          :title="banLine(account.ban)"
          :description="account.ban.reason ? `Reason: ${account.ban.reason}` : undefined"
          :actions="own ? [] : [{ label: 'Unban', color: 'error', variant: 'solid', loading: unban.isPending(account.id), disabled: busy, onClick: () => { void unban.execute(account!) } }]"
        />

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Account
            </h2>
          </template>
          <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-muted">
                Email
              </dt>
              <dd class="flex flex-wrap items-center gap-2 break-all text-highlighted">
                {{ account.email }}
                <UBadge
                  :color="account.emailVerified ? 'success' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ account.emailVerified ? 'Verified' : 'Not verified' }}
                </UBadge>
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Joined
              </dt>
              <dd class="text-highlighted">
                {{ formatDate(account.createdAt) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Signed in on
              </dt>
              <dd class="text-highlighted">
                {{ account.activeSessions ? `${account.activeSessions} ${account.activeSessions === 1 ? 'device' : 'devices'}` : 'No device' }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                Last active
              </dt>
              <dd class="text-highlighted">
                {{ account.lastActiveAt ? timeAgo(account.lastActiveAt) : 'Not signed in' }}
              </dd>
            </div>
          </dl>
          <p
            v-if="account.mustChangePassword"
            class="mt-3 text-sm text-muted"
          >
            Has a temporary password: they choose their own at their next sign-in.
          </p>
          <p
            v-if="account.isSuperadmin"
            class="mt-3 text-sm text-muted"
          >
            A super admin of the platform. Super admins are changed by hand, not from the console.
          </p>
        </UCard>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Cafes
            </h2>
          </template>
          <ul
            v-if="account.cafes.length"
            class="divide-y divide-default"
          >
            <li
              v-for="cafe in account.cafes"
              :key="cafe.id"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <ULink
                :to="`/platform/cafes/${cafe.id}`"
                class="font-medium text-highlighted underline-offset-2 hover:underline"
              >
                {{ cafe.name }}
              </ULink>
              <span class="text-sm text-muted">/c/{{ cafe.slug }}</span>
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ cafe.role === 'owner' ? 'Owner' : 'Staff' }}
              </UBadge>
              <UBadge
                v-if="cafe.onlyActiveOwner"
                color="warning"
                variant="subtle"
                size="sm"
              >
                Only owner
              </UBadge>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            Works in no cafe: a customer account.
          </p>
        </UCard>

        <UCard
          v-if="changeable"
          variant="outline"
        >
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Access
            </h2>
          </template>
          <div class="divide-y divide-default">
            <div class="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 class="font-medium text-highlighted">
                  Sign out everywhere
                </h3>
                <p class="text-sm text-muted">
                  For a lost phone or a shared device. Their password stays the same.
                </p>
              </div>
              <UButton
                label="Sign out everywhere"
                icon="i-lucide-log-out"
                color="neutral"
                variant="outline"
                class="shrink-0"
                :loading="signOut.isPending(account.id)"
                :disabled="busy || !account.activeSessions"
                @click="signOut.execute(account)"
              />
            </div>
            <div class="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 class="font-medium text-highlighted">
                  Temporary password
                </h3>
                <p class="text-sm text-muted">
                  When they can't get in. Their current password stops working.
                </p>
              </div>
              <UButton
                label="Set temporary password"
                icon="i-lucide-key-round"
                color="neutral"
                variant="outline"
                class="shrink-0"
                :disabled="busy || !!account.ban"
                @click="passwordModal.open({ account })"
              />
            </div>
          </div>
        </UCard>

        <UCard
          v-if="changeable && !account.ban"
          variant="outline"
          :ui="{ root: 'ring-error/40' }"
        >
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="font-semibold text-highlighted">
                Ban this account
              </h2>
              <p class="text-sm text-muted">
                They can't sign in anywhere until the ban ends. Nothing is deleted.
              </p>
            </div>
            <UButton
              label="Ban account"
              icon="i-lucide-ban"
              color="error"
              variant="outline"
              class="shrink-0"
              :disabled="busy"
              @click="banModal.open({ account })"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
