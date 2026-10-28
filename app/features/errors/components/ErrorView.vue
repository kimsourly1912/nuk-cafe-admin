<script setup lang="ts">
import type { ErrorKind } from '../utils/classify-error'
import { errorCopy } from '../utils/error-copy'
import ErrorCard from './ErrorCard.vue'

/**
 * The error page for a kind (see `classifyError`). The shell passes what it knows about the address
 * (cafe, workspace, the way home); the words are `errorCopy`'s.
 */
const props = defineProps<{
  kind: ErrorKind
  message: string
  workspace: boolean
  cafeName: string
  logoUrl: string | null
  home: { label: string, path: string }
}>()

const copy = computed(() => errorCopy(props.kind, props))
const router = useRouter()

// "Go back" returns to the page before when this tab has one, else it leaves for the home page.
function goBack() {
  if (window.history.state?.back) {
    clearError()
    router.back()
  }
  else {
    clearError({ redirect: props.home.path })
  }
}
</script>

<template>
  <ErrorCard
    v-if="kind === 'cafe-not-found'"
    wide
  >
    <div class="grid items-center gap-8 lg:grid-cols-2">
      <UIcon
        name="i-app-cafe-shop"
        class="mx-auto size-64 lg:size-96"
      />
      <div class="flex flex-col items-center gap-4 text-center lg:items-start lg:text-left">
        <UBadge
          :label="copy.title"
          color="primary"
          variant="subtle"
        />
        <h1 class="text-xl font-semibold text-highlighted">
          {{ copy.heading }}
        </h1>
        <p class="max-w-md text-muted">
          {{ copy.description }}
        </p>
        <UAlert
          icon="i-lucide-info"
          color="warning"
          variant="subtle"
          title="Are you at the cafe?"
          description="Please make sure you're using the correct QR code or link from this cafe."
          class="text-left max-lg:max-w-lg"
        />
        <UButton
          label="Go to home"
          icon="i-lucide-house"
          @click="clearError({ redirect: '/' })"
        />
      </div>
    </div>
  </ErrorCard>

  <ErrorCard v-else-if="kind === 'page-not-found'">
    <div class="flex flex-col items-center gap-3 text-center">
      <UIcon
        :name="copy.icon"
        class="h-40 w-44 sm:h-48 sm:w-52"
      />
      <p class="text-sm tracking-widest text-muted">
        404
      </p>
      <h1 class="text-3xl font-semibold text-highlighted">
        {{ copy.title }}
      </h1>
      <p class="max-w-sm text-muted">
        {{ copy.description }}
      </p>
      <div class="mt-3 flex flex-col items-center gap-3">
        <UButton
          :label="home.label"
          size="lg"
          @click="clearError({ redirect: home.path })"
        />
        <UButton
          label="Go back"
          color="neutral"
          variant="link"
          @click="goBack"
        />
      </div>
    </div>
  </ErrorCard>

  <ErrorCard v-else-if="kind === 'cafe-paused'">
    <div class="flex flex-col items-center gap-3 text-center">
      <CafeLogo
        v-if="logoUrl"
        :url="logoUrl"
        class="size-12"
      />
      <UIcon
        :name="copy.icon"
        class="size-48 sm:size-56"
      />
      <p class="text-sm tracking-widest text-primary">
        PAUSED
      </p>
      <h1 class="text-3xl font-semibold text-highlighted">
        {{ copy.title }}
      </h1>
      <p class="max-w-sm text-muted">
        {{ copy.description }}
      </p>
      <!-- No way back into a cafe that is paused: it can only be asked again. -->
      <UButton
        label="Try again"
        icon="i-lucide-rotate-cw"
        color="neutral"
        variant="outline"
        size="lg"
        class="mt-3"
        @click="reloadNuxtApp({ force: true })"
      />
    </div>
  </ErrorCard>

  <ErrorCard v-else>
    <div class="flex flex-col items-center gap-3 text-center">
      <UIcon
        :name="copy.icon"
        class="h-40 w-56 sm:h-48 sm:w-64"
      />
      <p class="text-sm tracking-widest text-primary">
        ERROR
      </p>
      <h1 class="text-3xl font-semibold text-highlighted">
        {{ copy.title }}
      </h1>
      <p class="max-w-sm text-muted">
        {{ copy.description }}
      </p>
      <div class="mt-3 flex flex-col items-center gap-3">
        <UButton
          :label="home.label"
          size="lg"
          @click="clearError({ redirect: home.path })"
        />
        <UButton
          label="Go back"
          color="neutral"
          variant="link"
          @click="goBack"
        />
      </div>
    </div>
  </ErrorCard>
</template>
