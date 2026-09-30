<script setup lang="ts">
/**
 * Admin → Telegram (`/admin/telegram`, step 8.1c, D112, the owner's frames): the chats the cafe's
 * messages go to. Connect your private chat or a staff group with a one-time link; each chat shows
 * its state (Connected, or Blocked when the bot was removed or blocked there) and when something
 * was last sent, with Send test and Disconnect (asked first), or Reconnect. Every admin sees every
 * chat. Below: which chat gets which notification, and the delivery history (8.1d, D113).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { DestinationKind, TelegramDestination } from '#shared/contracts/notifications'
import { useTelegramMutations, useTelegramOverview } from '../composables/useTelegram'
import DeliveryHistoryCard from './DeliveryHistoryCard.vue'
import NotificationRulesCard from './NotificationRulesCard.vue'
import TelegramConnectModal from './TelegramConnectModal.vue'

const { data, error, loading, refresh } = useTelegramOverview()
const { sendTest, disconnect, isBusy } = useTelegramMutations()

const enabled = computed(() => data.value?.enabled ?? false)
const destinations = computed(() => (data.value?.destinations ?? []).filter(d => !disconnect.isRemoved(d.id)))

const connectModal = useOverlay().create(TelegramConnectModal)
function connect(kind: DestinationKind) {
  if (!data.value?.botUsername) return
  connectModal.open({ kind, botUsername: data.value.botUsername })
}

async function test(destination: TelegramDestination) {
  const result = await sendTest.execute(destination)
  // Telegram said the chat is gone: show it as blocked.
  if (!result.ok && result.status === 'error' && result.error.code === 'TELEGRAM_BLOCKED') invalidate('telegram', 'reports')
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function actions(destination: TelegramDestination): DropdownMenuItem[] {
  return [
    destination.status === 'blocked'
      ? { label: 'Reconnect', icon: 'i-lucide-refresh-cw', onSelect: () => connect(destination.kind) }
      : { label: 'Send test', icon: 'i-lucide-send', onSelect: () => test(destination) },
    { label: 'Disconnect', icon: 'i-lucide-unlink', color: 'error', onSelect: () => disconnect.execute(destination) },
  ]
}
</script>

<template>
  <UDashboardPanel id="telegram">
    <template #header>
      <UDashboardNavbar title="Telegram">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-4xl space-y-6">
        <ApiErrorAlert
          v-if="error"
          :error="error"
          title="Could not load Telegram"
          @retry="refresh()"
        />

        <template v-else>
          <UAlert
            v-if="!loading && !enabled"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Telegram isn't set up for this app yet."
            description="The bot's token and settings are added on the server first (see the Telegram setup guide). Then chats can be connected here."
          />

          <div class="grid gap-4 md:grid-cols-2">
            <UCard as="section">
              <div class="flex h-full flex-col gap-3">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-user"
                    class="size-5 text-muted"
                  />
                  <h2 class="font-semibold text-highlighted">
                    Your private chat
                  </h2>
                </div>
                <p class="flex-1 text-sm text-muted">
                  For reports you send and the closing summary. Only you see it.
                </p>
                <UButton
                  label="Connect Telegram"
                  icon="i-lucide-send"
                  class="self-start"
                  :disabled="!enabled"
                  @click="connect('private')"
                />
              </div>
            </UCard>
            <UCard as="section">
              <div class="flex h-full flex-col gap-3">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-users"
                    class="size-5 text-muted"
                  />
                  <h2 class="font-semibold text-highlighted">
                    Staff group
                  </h2>
                </div>
                <p class="flex-1 text-sm text-muted">
                  For new orders. Everyone in the group sees order details sent there.
                </p>
                <UButton
                  label="Connect a group"
                  icon="i-lucide-users"
                  color="neutral"
                  variant="outline"
                  class="self-start"
                  :disabled="!enabled"
                  @click="connect('group')"
                />
              </div>
            </UCard>
          </div>

          <UCard
            v-if="enabled"
            as="section"
            aria-labelledby="connections"
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <template #header>
              <h2
                id="connections"
                class="font-semibold text-highlighted"
              >
                Connected chats
              </h2>
            </template>
            <ListSkeleton
              v-if="loading"
              label="Loading chats…"
              :count="2"
            />
            <p
              v-else-if="!destinations.length"
              class="p-4 text-sm text-muted sm:p-6"
            >
              No chats yet. Connect your private chat or a staff group above.
            </p>
            <ul
              v-else
              class="divide-y divide-default"
            >
              <li
                v-for="destination in destinations"
                :key="destination.id"
                class="flex items-start gap-3 p-4 sm:px-6"
                :class="isBusy(destination.id) && 'opacity-50'"
              >
                <UIcon
                  :name="destination.kind === 'group' ? 'i-lucide-users' : 'i-lucide-user'"
                  class="mt-0.5 size-5 shrink-0 text-muted"
                />
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium break-words text-highlighted">{{ destination.title }}</span>
                    <UBadge
                      v-if="destination.status === 'blocked'"
                      label="Blocked"
                      color="error"
                      variant="subtle"
                    />
                    <UBadge
                      v-else
                      label="Connected"
                      color="success"
                      variant="subtle"
                    />
                  </div>
                  <p class="text-sm text-muted">
                    {{ destination.kind === 'group' ? 'Group' : 'Private chat' }}
                    · {{ destination.lastSentAt ? `Last sent ${when(destination.lastSentAt)}` : 'Nothing sent yet' }}
                    <template v-if="destination.connectedBy">
                      · Connected by {{ destination.connectedBy }}
                    </template>
                  </p>
                  <p
                    v-if="destination.status === 'blocked'"
                    class="text-sm text-error"
                  >
                    {{ destination.kind === 'group' ? 'The bot was removed from this group.' : 'The bot was blocked in this chat.' }}
                    Nothing is delivered until it's reconnected.
                  </p>
                </div>
                <UIcon
                  v-if="isBusy(destination.id)"
                  name="i-lucide-loader-circle"
                  class="size-5 shrink-0 animate-spin text-muted"
                  aria-label="Working…"
                />
                <div
                  v-else
                  class="flex shrink-0 items-center gap-1"
                >
                  <UButton
                    v-if="destination.status === 'blocked'"
                    label="Reconnect"
                    color="neutral"
                    variant="outline"
                    class="max-sm:hidden"
                    @click="connect(destination.kind)"
                  />
                  <UButton
                    v-else
                    label="Send test"
                    color="neutral"
                    variant="outline"
                    class="max-sm:hidden"
                    @click="test(destination)"
                  />
                  <UDropdownMenu
                    :items="actions(destination)"
                    :content="{ align: 'end' }"
                  >
                    <UButton
                      icon="i-lucide-ellipsis-vertical"
                      color="neutral"
                      variant="ghost"
                      :aria-label="`Actions for ${destination.title}`"
                    />
                  </UDropdownMenu>
                </div>
              </li>
            </ul>
          </UCard>

          <template v-if="enabled && !loading">
            <NotificationRulesCard
              :destinations="destinations"
              :rules="data?.rules ?? []"
            />
            <DeliveryHistoryCard />
          </template>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
