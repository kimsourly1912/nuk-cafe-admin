<script setup lang="ts">
/**
 * Marketing → Channels (`/admin/channels`, M2a, D164): where promotions are posted. A Telegram
 * channel is connected with a one-time code; each shows its followers when it was connected and
 * its state (Connected, or "Bot removed" with Reconnect). Facebook Pages come later (M2b): shown
 * as coming, so the owner knows where they'll be.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MarketingChannel } from '#shared/contracts/marketing'
import { useChannelMutations } from '../composables/useChannelMutations'
import { useMarketingChannels } from '../composables/useMarketingChannels'
import ChannelConnectModal from './ChannelConnectModal.vue'

const tenantPath = useTenantPath()
const { data, error, loading, refresh } = useMarketingChannels()
const { disconnect } = useChannelMutations()

const enabled = computed(() => data.value?.telegram.enabled ?? false)
const channels = computed(() => (data.value?.channels ?? []).filter(c => !disconnect.isRemoved(c.id)))

const connectModal = useOverlay().create(ChannelConnectModal)
const connect = () => connectModal.open()

const followers = (count: number | null) => (count === null ? null : `${count.toLocaleString('en-US')} ${count === 1 ? 'subscriber' : 'subscribers'}`)

function actions(channel: MarketingChannel): DropdownMenuItem[] {
  return [
    ...(channel.username ? [{ label: 'Open in Telegram', icon: 'i-lucide-external-link', to: `https://t.me/${channel.username}`, target: '_blank' }] : []),
    ...(channel.status === 'removed' ? [{ label: 'Reconnect', icon: 'i-lucide-refresh-cw', onSelect: connect }] : []),
    { label: 'Disconnect', icon: 'i-lucide-unlink', color: 'error' as const, onSelect: () => disconnect.execute(channel) },
  ]
}
</script>

<template>
  <UDashboardPanel
    id="channels"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar title="Channels">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            v-if="enabled && channels.length"
            label="Connect a channel"
            icon="i-lucide-plus"
            @click="connect()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <p class="text-sm text-muted">
          Post your promotions to your followers in one click: the poster, a caption and an <strong class="text-highlighted">Order now</strong> button that opens your menu with the offer. Orders placed from a post are counted on the promotion's page.
        </p>

        <ApiErrorAlert
          v-if="error && !data"
          :error="error"
          title="Could not load the channels"
          @retry="refresh()"
        />

        <ListSkeleton
          v-else-if="loading"
          label="Loading channels…"
          :count="2"
        />

        <template v-else>
          <UAlert
            v-if="!enabled"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Telegram isn't set up for this app yet."
            description="The platform team adds the bot on the server first. Then channels can be connected here."
          />

          <UCard
            as="section"
            aria-labelledby="telegram-channels"
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-send"
                  class="size-5 text-muted"
                />
                <h2
                  id="telegram-channels"
                  class="font-semibold text-highlighted"
                >
                  Telegram channels
                </h2>
              </div>
            </template>

            <div
              v-if="!channels.length"
              class="space-y-3 p-4 sm:p-6"
            >
              <p class="text-sm text-muted">
                No channel yet. Connect your cafe's Telegram channel: you add our bot as an admin, post a short code there, and confirm here. It takes about a minute.
              </p>
              <UButton
                label="Connect a channel"
                icon="i-lucide-plus"
                :disabled="!enabled"
                @click="connect()"
              />
            </div>

            <ul
              v-else
              class="divide-y divide-default"
            >
              <li
                v-for="channel in channels"
                :key="channel.id"
                class="flex items-start gap-3 p-4 sm:px-6"
                :class="disconnect.isPending(channel.id) && 'opacity-50'"
              >
                <UIcon
                  name="i-lucide-megaphone"
                  class="mt-0.5 size-5 shrink-0 text-muted"
                />
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium break-words text-highlighted">{{ channel.title }}</span>
                    <UBadge
                      v-if="channel.status === 'removed'"
                      label="Bot removed"
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
                    {{ [channel.username ? `@${channel.username}` : 'Private channel', followers(channel.subscriberCount), `Connected ${formatDate(channel.connectedAt)}${channel.connectedBy ? ` by ${channel.connectedBy}` : ''}`].filter(Boolean).join(' · ') }}
                  </p>
                  <p
                    v-if="channel.status === 'removed'"
                    class="text-sm text-error"
                  >
                    The bot is no longer an admin there. Nothing is posted until it's reconnected.
                  </p>
                </div>
                <UIcon
                  v-if="disconnect.isPending(channel.id)"
                  name="i-lucide-loader-circle"
                  class="size-5 shrink-0 animate-spin text-muted"
                  aria-label="Working…"
                />
                <div
                  v-else
                  class="flex shrink-0 items-center gap-1"
                >
                  <UButton
                    v-if="channel.status === 'removed'"
                    label="Reconnect"
                    color="neutral"
                    variant="outline"
                    class="max-sm:hidden"
                    :disabled="!enabled"
                    @click="connect()"
                  />
                  <UDropdownMenu
                    :items="actions(channel)"
                    :content="{ align: 'end' }"
                  >
                    <UButton
                      icon="i-lucide-ellipsis-vertical"
                      color="neutral"
                      variant="ghost"
                      :aria-label="`Actions for ${channel.title}`"
                    />
                  </UDropdownMenu>
                </div>
              </li>
            </ul>
          </UCard>

          <UCard
            as="section"
            aria-labelledby="facebook-pages"
          >
            <div class="flex items-start gap-3">
              <UIcon
                name="i-lucide-facebook"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2
                    id="facebook-pages"
                    class="font-semibold text-highlighted"
                  >
                    Facebook Page
                  </h2>
                  <UBadge
                    label="Coming soon"
                    color="neutral"
                    variant="subtle"
                  />
                </div>
                <p class="text-sm text-muted">
                  Posting to your Facebook Page needs Facebook's approval of this app first. Until then, download the poster from a promotion's page and post it there yourself.
                </p>
              </div>
            </div>
          </UCard>

          <p class="text-sm text-muted">
            To post a promotion, open it in <ULink
              :to="tenantPath('/admin/promotions')"
              class="text-primary underline"
            >Promotions</ULink> and choose <strong class="text-highlighted">Post to channels</strong>.
          </p>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
