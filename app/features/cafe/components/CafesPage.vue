<script setup lang="ts">
/**
 * Your cafes (`/cafes`, T2c, D144): the cafes the signed-in account works in, one row each: the
 * logo, the name (wrapping, never squeezed), the role as a badge (owner's request), and under them
 * the workspaces it may open there (Admin for an owner, Counter for an owner or branch staff). A
 * paused cafe is listed without them. Each one opens as a full page load (D141). Signed out, it
 * sends the person to sign in and back. With no cafe: the illustration, Switch account and Back to
 * home. A platform team account also gets Open the platform console (Q5, D241). A task-flow page
 * (page-patterns §5): a card from `sm`, the whole screen on phones.
 */
import type { Workspace } from '#shared/contracts/account'
import type { AccountCafe } from '#shared/contracts/cafe'
import { useAccountActions, useAccountSession } from '~/features/account'
import { useAccountCafes, usePlatformTeam } from '../composables/useAccountCafes'

const { data: cafes, error, loading: cafesLoading, refresh } = useAccountCafes()
const { data: platformTeam, known: teamKnown, error: teamError, refresh: refreshTeam } = usePlatformTeam()
const { account, known, error: accountError, refresh: refreshAccount } = useAccountSession()
const decidingError = computed(() => error.value ?? accountError.value ?? teamError.value)
const retry = () => Promise.all([refresh(), refreshTeam(), refreshAccount()])
const signedOut = computed(() => error.value?.kind === 'unauthorized')
watch(signedOut, (out) => {
  if (out) void navigateTo({ path: '/sign-in', query: { redirect: CAFES_PATH } }, { replace: true })
}, { immediate: true })

// One skeleton until everything that decides the page answers: the empty state's words and actions
// depend on the platform role, the footer on the account (D238).
const loading = computed(() => signedOut.value || (!decidingError.value && (cafesLoading.value || !known.value
  || !teamKnown.value)))

/** Owners alone open the admin app; everyone else listed is branch staff. */
const isOwner = (cafe: AccountCafe) => cafe.workspaces.includes('admin')

const WORKSPACES: { workspace: Workspace, label: string, icon: string }[] = [
  { workspace: 'admin', label: 'Admin', icon: 'i-lucide-layout-dashboard' },
  { workspace: 'counter', label: 'Counter', icon: 'i-lucide-receipt' },
]

const notify = useNotify()
const { signOut } = useAccountActions()
const signingOut = ref(false)

/** Switch account: signed out, then sign in again and come back here. */
async function switchAccount() {
  signingOut.value = true
  try {
    await signOut()
    await navigateTo({ path: '/sign-in', query: { redirect: CAFES_PATH } })
  }
  catch (signOutError) {
    notify.error('Couldn\'t sign out', signOutError)
  }
  finally {
    signingOut.value = false
  }
}
</script>

<template>
  <TaskFrame>
    <template #header>
      <div class="flex items-start justify-between gap-2">
        <div>
          <h1 class="text-xl font-semibold text-highlighted">
            Your cafes
          </h1>
          <p class="mt-1 text-sm text-muted">
            Choose a cafe to continue.
          </p>
        </div>
        <!-- `data-color-mode`: the `auth` layout hides its corner button. -->
        <UColorModeButton data-color-mode />
      </div>
    </template>

    <ListSkeleton
      v-if="loading"
      label="Loading your cafes…"
      variant="row"
      :count="2"
    />
    <ApiErrorAlert
      v-else-if="decidingError"
      :error="decidingError"
      title="Could not load your cafes"
      @retry="retry()"
    />
    <div
      v-else-if="!cafes?.length"
      class="flex flex-col items-center gap-2 rounded-lg bg-elevated/50 p-6 text-center"
    >
      <UIcon
        name="i-app-cafe-access-illustration"
        class="mb-2 h-32 w-52"
      />
      <h2 class="font-semibold text-highlighted">
        You don't have access to a cafe yet
      </h2>
      <p class="text-sm text-muted">
        {{ platformTeam ? 'This is a platform team account: its work is in the platform console.' : 'Ask a cafe owner to add this account, or switch to another account.' }}
      </p>
    </div>
    <ul
      v-else
      class="space-y-2"
      aria-label="Your cafes"
    >
      <li
        v-for="cafe in cafes"
        :key="cafe.slug"
        class="space-y-3 rounded-lg border border-default p-3"
      >
        <div class="flex items-center gap-3">
          <span class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated">
            <CafeLogo
              :url="cafe.logoUrl"
              :class="cafe.logoUrl ? 'size-full' : 'size-6'"
            />
          </span>
          <!-- The name has the line to itself and wraps; the badges keep their width. -->
          <p class="min-w-0 flex-1 font-medium wrap-break-word text-highlighted">
            {{ cafe.name }}
          </p>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <UBadge
              :label="isOwner(cafe) ? 'Owner' : 'Staff'"
              color="neutral"
              variant="subtle"
            />
            <UBadge
              v-if="cafe.status === 'suspended'"
              label="Paused"
              color="warning"
              variant="subtle"
            />
          </div>
        </div>
        <p
          v-if="cafe.status === 'suspended'"
          class="text-sm text-muted"
        >
          Paused by the platform team: its admin and counter are closed for now.
        </p>
        <div
          v-else
          class="grid auto-cols-fr grid-flow-col gap-2"
        >
          <template
            v-for="entry in WORKSPACES"
            :key="entry.workspace"
          >
            <UButton
              v-if="cafe.workspaces.includes(entry.workspace)"
              :label="entry.label"
              :icon="entry.icon"
              :to="workspaceUrl(cafe.slug, entry.workspace)"
              external
              color="neutral"
              variant="outline"
              :aria-label="`${entry.label}, ${cafe.name}`"
              block
            />
          </template>
        </div>
      </li>
    </ul>

    <template
      v-if="!loading && !decidingError"
      #footer
    >
      <UButton
        v-if="platformTeam"
        label="Open the platform console"
        icon="i-lucide-layers"
        :to="PLATFORM_CONSOLE_PATH"
        external
        :color="cafes?.length ? 'neutral' : 'primary'"
        :variant="cafes?.length ? 'outline' : 'solid'"
        block
      />
      <div
        v-if="!error && !cafes?.length"
        class="grid gap-2 sm:grid-cols-2"
      >
        <UButton
          label="Switch account"
          icon="i-lucide-user"
          :color="platformTeam ? 'neutral' : 'primary'"
          :variant="platformTeam ? 'outline' : 'solid'"
          :loading="signingOut"
          block
          @click="switchAccount"
        />
        <UButton
          label="Back to home"
          icon="i-lucide-house"
          :to="SITE_HOME_PATH"
          color="neutral"
          variant="outline"
          block
        />
      </div>
      <p
        v-if="account"
        class="text-center text-sm text-muted"
      >
        Signed in as <span class="font-medium break-all text-default">{{ account.email }}</span>
      </p>
    </template>
  </TaskFrame>
</template>
