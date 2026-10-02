<script setup lang="ts">
/**
 * Which chat gets which notification (step 8.1d, D113, the owner's frames): new orders, payments,
 * the closing summary and server errors (step 10.4, D119), each with a switch per connected chat, saved at once. A closing summary
 * can bring its CSV; sent to a group, everyone there sees the figures (said next to the switch).
 */
import type { NotificationKind, NotificationRule, TelegramDestination } from '#shared/contracts/notifications'
import { useNotificationMutations } from '../composables/useTelegram'

const props = defineProps<{ destinations: TelegramDestination[], rules: NotificationRule[] }>()

const { setRule } = useNotificationMutations()

const KINDS: { kind: NotificationKind, title: string, description: string, icon: string }[] = [
  { kind: 'new_order', title: 'New orders', description: 'When a customer places an order, before it\'s paid: the items, notes and total, with Open order for the counter app.', icon: 'i-lucide-receipt' },
  { kind: 'payment', title: 'Payment confirmed', description: 'When the counter takes an order\'s payment: preparation can start.', icon: 'i-lucide-banknote' },
  { kind: 'closing_summary', title: 'Closing summary', description: 'The day\'s figures, 30 minutes after closing time. Not sent on a closed day.', icon: 'i-lucide-chart-column' },
  { kind: 'server_error', title: 'Server errors and reminders', description: 'When the app fails unexpectedly: which page and a request id to find it in the logs, at most one per page every 15 minutes. Also reminds you before the Bakong token expires.', icon: 'i-lucide-triangle-alert' },
]

const ruleOf = (kind: NotificationKind, destinationId: string) => props.rules.find(r => r.kind === kind && r.destinationId === destinationId)
const pending = (kind: NotificationKind, destinationId: string) => setRule.isPending(`${kind}:${destinationId}`)

function toggle(kind: NotificationKind, destination: TelegramDestination, enabled: boolean) {
  void setRule.execute({ kind, destinationId: destination.id, enabled, attachCsv: ruleOf(kind, destination.id)?.attachCsv ?? false })
}

function toggleCsv(destination: TelegramDestination, attachCsv: boolean) {
  void setRule.execute({ kind: 'closing_summary', destinationId: destination.id, enabled: true, attachCsv })
}
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="notifications"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <h2
        id="notifications"
        class="font-semibold text-highlighted"
      >
        Notifications
      </h2>
      <p class="text-sm text-muted">
        Choose which chats get each message. Changes are saved at once.
      </p>
    </template>

    <p
      v-if="!destinations.length"
      class="p-4 text-sm text-muted sm:p-6"
    >
      Connect a chat first.
    </p>
    <ul
      v-else
      class="divide-y divide-default"
    >
      <li
        v-for="item in KINDS"
        :key="item.kind"
        class="space-y-3 p-4 sm:px-6"
      >
        <div class="flex gap-3">
          <UIcon
            :name="item.icon"
            class="mt-0.5 size-5 shrink-0 text-muted"
          />
          <div>
            <h3 class="font-medium text-highlighted">
              {{ item.title }}
            </h3>
            <p class="text-sm text-muted">
              {{ item.description }}
            </p>
          </div>
        </div>
        <fieldset class="space-y-3 ps-8">
          <legend class="sr-only">
            Send {{ item.title.toLowerCase() }} to
          </legend>
          <div
            v-for="destination in destinations"
            :key="destination.id"
            class="space-y-2"
          >
            <USwitch
              :model-value="Boolean(ruleOf(item.kind, destination.id))"
              :label="destination.title"
              :description="destination.status === 'blocked' ? 'Blocked: nothing is delivered until it\'s reconnected' : destination.kind === 'group' ? 'Group' : 'Private chat'"
              :loading="pending(item.kind, destination.id)"
              :disabled="pending(item.kind, destination.id)"
              @update:model-value="(on: boolean) => toggle(item.kind, destination, on)"
            />
            <template v-if="item.kind === 'closing_summary' && ruleOf(item.kind, destination.id)">
              <UCheckbox
                :model-value="ruleOf(item.kind, destination.id)!.attachCsv"
                label="Attach CSV"
                description="The day's figures as a file, in a second message."
                class="ps-11"
                :disabled="pending(item.kind, destination.id)"
                @update:model-value="(on: boolean | 'indeterminate') => toggleCsv(destination, on === true)"
              />
              <p
                v-if="destination.kind === 'group'"
                class="ps-11 text-sm text-warning"
              >
                Everyone in {{ destination.title }} will see your sales.
              </p>
            </template>
          </div>
        </fieldset>
      </li>
    </ul>
  </UCard>
</template>
