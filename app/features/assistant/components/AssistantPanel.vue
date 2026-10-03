<script setup lang="ts">
import { ASSISTANT_QUESTION_MAX } from '#shared/contracts/assistant'
import { useAssistant } from '../composables/useAssistant'
import { useAssistantChat } from '../composables/useAssistantChat'
import type { AssistantMessage } from '../utils/chat'
import { linksOf, suggestionsFor, textOf } from '../utils/chat'
import AssistantText from './AssistantText.vue'

/**
 * The help assistant's panel (step 9.1, D109): a `USidebar` on the right, beside the page from `lg`
 * (the page narrows while it's open) and a slide-over below. Suggested questions for the page, the
 * answers streamed with buttons to the pages they mention, Stop, Try again and Clear chat. The
 * conversation lives in this tab only; a change of account clears it.
 */
const { status, open } = useAssistant()
const route = useRoute()
const { isExpanded } = useLayoutContext()
const tenantPath = useTenantPath()
// The page inside the cafe (`/admin/products`, D141): the help guide's page list and its links name
// pages that way; the links get this cafe's address when shown.
const page = computed(() => splitTenantUrl(route.path)?.path ?? route.path)

const chat = useAssistantChat({ page: () => page.value, onFinish: () => void status.refresh() })
const input = ref('')

const messages = computed(() => chat.messages.value)
const busy = computed(() => chat.status.value === 'submitted' || chat.status.value === 'streaming')
const suggestions = computed(() => suggestionsFor(page.value))

/** What to say about a failed answer: the server's message, or a plain one; nothing when cancelled. */
const failure = computed(() => {
  const error = chat.error.value
  if (!error) return null
  const apiError = error instanceof ApiError ? error : null
  if (apiError && isSilentError(apiError)) return null
  return {
    message: apiError?.message ?? 'The assistant can\'t answer right now. Try again in a moment.',
    // Past today's limit, trying again only fails again.
    retry: apiError?.code !== 'AI_LIMIT_REACHED',
  }
})

const left = computed(() => (status.data.value ? status.data.value.dailyLimit - status.data.value.usedToday : null))

function ask(question: string) {
  const text = question.trim()
  if (!text || busy.value) return
  input.value = ''
  void chat.sendMessage({ text })
}

function clear() {
  void chat.stop()
  chat.messages.value = []
  chat.clearError()
  input.value = ''
}

/** A link on a phone leaves the slide-over for the page. */
function followed() {
  if (!isExpanded.value) open.value = false
}

// A new identity must not see the previous one's conversation (D29).
const nuxtApp = useNuxtApp()
const unhook = nuxtApp.hook('app:session-changed', () => {
  clear()
  open.value = false
})
onScopeDispose(unhook)

const asMessage = (message: unknown) => message as AssistantMessage
</script>

<template>
  <USidebar
    v-model:open="open"
    side="right"
    collapsible="offcanvas"
    title="Assistant"
    description="Answers from the help guide"
    close
    :style="{ '--sidebar-width': '26rem' }"
    :ui="{ body: 'p-0 gap-0', footer: 'flex-col items-stretch gap-2' }"
    aria-label="Assistant"
    :inert="!open"
  >
    <!-- Contents only while open: closed, nothing in it can take focus (its question box focuses
         itself when it appears). The conversation stays in this component. -->
    <template #actions>
      <UButton
        v-if="open && messages.length"
        label="Clear chat"
        icon="i-lucide-eraser"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="clear"
      />
    </template>

    <div
      v-if="!open"
      hidden
    />
    <div
      v-else-if="!messages.length"
      class="flex flex-col gap-3 p-4"
    >
      <p class="text-sm text-muted">
        Ask how to do something in this portal. The assistant explains; it doesn't change anything.
      </p>
      <p class="text-xs font-medium uppercase text-dimmed">
        Try asking
      </p>
      <UButton
        v-for="question in suggestions"
        :key="question"
        :label="question"
        color="neutral"
        variant="outline"
        block
        class="justify-start text-left"
        @click="ask(question)"
      />
    </div>

    <UChatMessages
      v-else
      :messages="messages"
      :status="chat.status.value"
      :user="{ side: 'right', variant: 'soft' }"
      :assistant="{ side: 'left', variant: 'naked' }"
      compact
      class="p-4"
    >
      <template #content="{ message }">
        <AssistantText :text="textOf(asMessage(message))" />
        <div
          v-if="linksOf(asMessage(message)).length"
          class="mt-2 flex flex-wrap gap-2"
        >
          <UButton
            v-for="link in linksOf(asMessage(message))"
            :key="link.path"
            :to="tenantPath(link.path)"
            :label="`Open ${link.title}`"
            trailing-icon="i-lucide-arrow-right"
            color="neutral"
            variant="outline"
            size="sm"
            @click="followed"
          />
        </div>
      </template>
    </UChatMessages>

    <template
      v-if="open"
      #footer
    >
      <UAlert
        v-if="failure"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="failure.message"
        :actions="failure.retry ? [{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: () => void chat.regenerate() }] : undefined"
      />
      <UChatPrompt
        v-model="input"
        placeholder="Ask about this portal…"
        :maxlength="ASSISTANT_QUESTION_MAX"
        :maxrows="6"
        aria-label="Your question"
        @submit="ask(input)"
      >
        <UChatPromptSubmit
          :status="chat.status.value"
          @stop="chat.stop()"
          @reload="chat.regenerate()"
        />
      </UChatPrompt>
      <p class="text-xs text-dimmed">
        AI can make mistakes: check before you act.<template v-if="left !== null && left <= 10">
          {{ left === 1 ? '1 question' : `${Math.max(left, 0)} questions` }} left today.
        </template>
      </p>
    </template>
  </USidebar>
</template>
