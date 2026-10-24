<script setup lang="ts">
/**
 * Post to channels (M2a, D164): a promotion posted to the cafe's channels, now or at a time.
 * Left: the channels, the caption (started from the promotion), the poster switch and when.
 * Right (below on phones): the post as followers see it in Telegram, with its Order now button.
 * Post now waits for Telegram's answer and closes with how each channel went; a refused channel
 * is said on the posts list with Try again.
 */
import { POST_CAPTION_MAX, POST_SCHEDULE_MAX_DAYS, defaultCaption } from '#shared/contracts/marketing'
import type { Promotion } from '#shared/contracts/menu-promotions'
import { useMarketingChannels } from '~/features/marketing'
import { usePostMutations } from '../composables/usePromotionPosts'
import type { PostForm } from '../schemas/post-form'
import { localInputValue, postFormIssues, postRequest, suggestedTime } from '../schemas/post-form'

const props = defineProps<{ promotion: Promotion }>()
// `update:open` is declared so closing (X, Esc, outside click) goes through `unsaved` instead of
// the overlay closing itself, which would hide the modal even when the person chooses Keep editing.
const emit = defineEmits<{ 'close': [posted: boolean], 'update:open': [open: boolean] }>()

const tenantPath = useTenantPath()
const { isCompact } = useLayoutContext()
const { data, error, loading, refresh } = useMarketingChannels()
const { create } = usePostMutations()

const channels = computed(() => data.value?.channels ?? [])
const connected = computed(() => channels.value.filter(c => c.status === 'connected'))
const hasPoster = computed(() => !!props.promotion.poster)

const form = reactive<PostForm>({
  channelIds: [],
  caption: defaultCaption(props.promotion),
  withPoster: true,
  when: 'now',
  at: suggestedTime(new Date()),
})
// With one channel, it's chosen already.
watch(connected, (list) => {
  if (list.length === 1 && !form.channelIds.length) form.channelIds = [list[0]!.id]
}, { immediate: true })

const saving = ref(false)
const tried = ref(false)
const unsaved = useModalUnsavedChanges(form, { paused: saving, close: () => emit('close', false) })
const issues = computed(() => postFormIssues(form, new Date()))
// A time in the past is said as soon as it's chosen (it can't be fixed later by typing elsewhere);
// the other fields wait for the first submit so an untouched form isn't shouted at.
const shown = computed<typeof issues.value>(() => (tried.value ? issues.value : { at: issues.value.at }))

/** One key per request as sent: a retry of the same post reuses it; any change makes a new one. */
const key = ref(crypto.randomUUID())
watch(() => JSON.stringify(form), () => {
  key.value = crypto.randomUUID()
})

function toggle(id: string, on: boolean) {
  form.channelIds = on ? [...form.channelIds, id] : form.channelIds.filter(c => c !== id)
}

async function submit() {
  tried.value = true
  if (Object.keys(issues.value).length || saving.value) return
  saving.value = true
  const result = await create.execute({ promotionId: props.promotion.id, body: postRequest(form, hasPoster.value), key: key.value })
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    emit('close', true)
  }
}
useSubmitShortcut(submit)

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const whenItems = [
  { label: 'Now', value: 'now' },
  { label: 'Later', value: 'later' },
]
const previewChannel = computed(() => connected.value.find(c => form.channelIds.includes(c.id)) ?? connected.value[0])
</script>

<template>
  <AppModal
    :title="`Post “${promotion.name}”`"
    description="To your channels, with an Order now button that opens your menu with this offer."
    :fullscreen="isCompact"
    :ui="{ content: 'sm:max-w-4xl', body: 'p-0 sm:p-0' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <div class="grid md:grid-cols-[minmax(0,1fr)_20rem]">
        <form
          class="space-y-5 p-4 sm:p-6"
          novalidate
          @submit.prevent="submit()"
        >
          <ApiErrorAlert
            v-if="error && !data"
            :error="error"
            title="Could not load your channels"
            @retry="refresh()"
          />
          <USkeleton
            v-else-if="loading"
            class="h-16 w-full"
          />
          <div
            v-else-if="!connected.length"
            class="space-y-3 rounded-lg border border-dashed border-accented p-4"
          >
            <p class="text-sm text-muted">
              No channel is connected yet. Connect your Telegram channel first: it takes about a minute.
            </p>
            <UButton
              label="Go to Channels"
              icon="i-lucide-megaphone"
              color="neutral"
              variant="outline"
              :to="tenantPath('/admin/channels')"
            />
          </div>
          <fieldset
            v-else
            class="space-y-2"
          >
            <legend class="mb-2 text-sm font-medium text-highlighted">
              Channels
            </legend>
            <label
              v-for="channel in channels"
              :key="channel.id"
              class="flex items-center gap-3 rounded-md border border-default p-3"
              :class="channel.status === 'connected' ? 'cursor-pointer has-checked:border-primary' : 'opacity-60'"
            >
              <UCheckbox
                :model-value="form.channelIds.includes(channel.id)"
                :disabled="channel.status !== 'connected' || saving"
                :aria-label="channel.title"
                @update:model-value="(on: boolean | 'indeterminate') => toggle(channel.id, on === true)"
              />
              <UIcon
                name="i-lucide-send"
                class="size-4 shrink-0 text-muted"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-highlighted">{{ channel.title }}</span>
                <span class="block text-xs text-muted">{{ channel.status === 'connected' ? (channel.username ? `@${channel.username}` : 'Private channel') : 'Bot removed: reconnect it on Channels' }}</span>
              </span>
            </label>
            <p
              v-if="shown.channelIds"
              class="text-sm text-error"
            >
              {{ shown.channelIds }}
            </p>
          </fieldset>

          <UFormField
            label="Caption"
            :error="shown.caption"
            :hint="`${form.caption.trim().length}/${POST_CAPTION_MAX}`"
          >
            <UTextarea
              v-model="form.caption"
              :rows="6"
              autoresize
              :maxrows="12"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>

          <USwitch
            v-if="hasPoster"
            v-model="form.withPoster"
            label="Include the poster"
            description="The caption goes under the poster."
            :disabled="saving"
          />
          <p
            v-else
            class="text-sm text-muted"
          >
            No poster: the caption is posted as a message. Add a poster by editing the promotion.
          </p>

          <div class="space-y-3">
            <URadioGroup
              v-model="form.when"
              legend="When"
              orientation="horizontal"
              :items="whenItems"
              :disabled="saving"
            />
            <UFormField
              v-if="form.when === 'later'"
              label="Date and time"
              :error="shown.at"
              :help="`Your device's time (${timezone}). Up to 30 days ahead.`"
            >
              <DateTimeInput
                v-model="form.at"
                label="Date and time"
                :min="localInputValue(new Date())"
                :max="localInputValue(new Date(Date.now() + POST_SCHEDULE_MAX_DAYS * 86_400_000))"
                :disabled="saving"
                class="w-full sm:w-72"
              />
            </UFormField>
          </div>
        </form>

        <aside
          class="space-y-3 border-default bg-muted p-4 max-md:border-t sm:p-6 md:border-l"
          aria-label="Preview"
        >
          <p class="text-sm font-medium text-highlighted">
            How followers see it
          </p>
          <div class="overflow-hidden rounded-xl bg-default shadow-sm ring ring-default">
            <p class="px-3 pt-2 text-xs font-semibold text-primary">
              {{ previewChannel?.title ?? 'Your channel' }}
            </p>
            <img
              v-if="hasPoster && form.withPoster && promotion.poster"
              :src="promotion.poster.url"
              alt=""
              class="mt-2 max-h-72 w-full object-cover"
            >
            <p
              class="px-3 py-2 text-sm break-words whitespace-pre-wrap text-default"
              data-testid="post-preview"
            >
              {{ form.caption.trim() || 'Your caption' }}
            </p>
          </div>
          <div class="rounded-lg bg-default py-2 text-center text-sm font-medium text-primary ring ring-default">
            Order now
          </div>
          <p class="text-xs text-muted">
            The button opens your menu with this offer. Orders placed from it are counted on this page.
          </p>
        </aside>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UButton
          :label="form.when === 'now' ? 'Post now' : 'Schedule post'"
          :icon="form.when === 'now' ? 'i-lucide-send' : 'i-lucide-calendar-clock'"
          :loading="saving"
          :disabled="!connected.length"
          @click="submit()"
        />
      </div>
    </template>
  </AppModal>
</template>
