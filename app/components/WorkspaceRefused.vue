<script setup lang="ts">
/**
 * A session this workspace refuses (D239), after a refused sign-in or on arriving at the sign-in
 * already signed in: in place of the admin or counter sign-in form, what it may open instead. The
 * account stays signed in: this cafe's other workspace (a manager on the admin sign-in: Open the
 * counter), Your cafes when it works at another cafe, the platform console for a platform team
 * account, and Use another account, which signs out and shows the form again (a shared counter
 * tablet is never left on someone else's session without a way out). With nothing else to offer (a
 * customer), the primary action is the safe page, Back to the cafe's menu. When the check failed (the
 * network, Q4), it says so and offers Try again (`retry`); the session is kept.
 *
 * The platform console's sign-in uses it too (D241): no cafe there, so the header is the platform's,
 * Your cafes is the way on for a cafe's staff, and Back to home the safe page for anyone else.
 *
 * Each workspace is opened as a full page load: its session and data start fresh (D141).
 *
 * @example
 * <WorkspaceRefused v-if="refused" workspace="admin" :access="refused" :email="state.email" :title="`${name} Admin`" @signed-out="refused = null" />
 */
import type { OtherAccess, WorkspaceDoor } from '~/utils/account-cafes'

const props = defineProps<{
  /** The workspace that refused the account. */
  workspace: WorkspaceDoor
  /** `null`: what the account opens couldn't be checked (Q4). */
  access: OtherAccess | null
  /** The account signed in, so a shared device shows whose session it is. */
  email: string
  /** The frame's heading: "<cafe> Admin", "<cafe> Counter", the platform's name. */
  title: string
  /** Try again is checking. */
  retrying?: boolean
}>()

const emit = defineEmits<{ 'signed-out': [], 'retry': [] }>()

// The console has no cafe (D241): no slug, no cafe profile.
const tenantSlug = useOptionalTenantSlug()
const slug = computed(() => tenantSlug.value ?? '')
const { name, logoUrl } = useCafe()
const inConsole = computed(() => props.workspace === 'console')
const authFetch = useAuthRequest()
const signingOut = ref(false)

const workspaceNames: Record<WorkspaceDoor, string> = { admin: 'the admin app', counter: 'the counter', console: 'the platform console' }

const description = computed(() => {
  if (!props.access) return `We couldn't check where this account works. Check the connection and try again.`
  const { here, elsewhere, platform } = props.access
  if (inConsole.value) return elsewhere
    ? 'This account isn\'t on the platform team. Open a cafe you work at from Your cafes.'
    : 'Only the platform team uses the console.'
  if (here) return `This account works at ${name.value}'s ${here === 'counter' ? 'counter' : 'admin app'}, not in ${workspaceNames[props.workspace]}.`
  if (elsewhere) return `This account ${props.workspace === 'admin' ? `doesn't manage ${name.value}` : `doesn't work at ${name.value}`}. Open a cafe you work at from Your cafes.`
  // The platform team never opens a cafe's data here (D135); support access goes through the console (D193).
  if (platform) return props.workspace === 'admin'
    ? 'This is a platform team account: it doesn\'t open a cafe\'s admin app. With the owner\'s permission, look at a cafe from the platform console.'
    : 'This is a platform team account: it doesn\'t work at a cafe\'s counter.'
  return props.workspace === 'admin' ? `Only ${name.value}'s owners use the admin app.` : `Only ${name.value}'s staff use the counter.`
})

/**
 * The one way on that gets the primary button: Try again when the check failed, else this cafe's other
 * workspace, Your cafes, the console, or, with nothing to offer, the cafe's menu (the safe page).
 */
const primary = computed(() => {
  const access = props.access
  if (!access) return 'retry'
  return access.here ? 'here' : access.elsewhere ? 'elsewhere' : access.platform ? 'platform' : 'menu'
})

// Announced and focused on arrival, like the form's error it replaces (page-patterns §5).
const panel = useTemplateRef<HTMLElement>('panel')
onMounted(() => panel.value?.focus())

async function useAnotherAccount() {
  signingOut.value = true
  try {
    await authFetch('/sign-out')
  }
  catch {
    // Signed out here anyway; the cookie expires on its own.
  }
  finally {
    signingOut.value = false
  }
  emit('signed-out')
}
</script>

<template>
  <TaskFrame>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          v-if="inConsole"
          name="i-lucide-layers"
          class="size-6 text-primary"
        />
        <CafeLogo
          v-else
          :url="logoUrl"
          class="size-6"
        />
        <h1 class="text-lg font-semibold">
          {{ title }}
        </h1>
      </div>
    </template>

    <div
      ref="panel"
      role="alert"
      tabindex="-1"
      class="flex flex-col items-center gap-2 py-6 text-center"
    >
      <UIcon
        name="i-lucide-lock"
        class="size-10 text-dimmed"
      />
      <h2 class="font-medium text-highlighted">
        No access to {{ workspaceNames[workspace] }}
      </h2>
      <p class="text-sm text-muted">
        {{ description }}
      </p>
      <p class="text-sm text-muted">
        Signed in as <span class="font-medium text-default break-all">{{ email }}</span>
      </p>
    </div>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <UButton
          v-if="!access"
          label="Try again"
          icon="i-lucide-rotate-cw"
          block
          :loading="retrying"
          @click="emit('retry')"
        />
        <UButton
          v-if="access?.here"
          :label="access.here === 'counter' ? 'Open the counter' : 'Open the admin app'"
          :to="workspaceUrl(slug, access.here)"
          external
          block
        />
        <UButton
          v-if="primary === 'menu'"
          :label="inConsole ? 'Back to home' : `Back to ${name}'s menu`"
          icon="i-lucide-house"
          :to="inConsole ? '/' : tenantUrl(slug, '/')"
          external
          block
        />
        <UButton
          v-if="access?.elsewhere"
          label="Your cafes"
          icon="i-lucide-store"
          :to="CAFES_PATH"
          :color="primary === 'elsewhere' ? 'primary' : 'neutral'"
          :variant="primary === 'elsewhere' ? 'solid' : 'outline'"
          block
        />
        <UButton
          v-if="access?.platform"
          label="Open the platform console"
          :to="PLATFORM_CONSOLE_PATH"
          external
          :color="primary === 'platform' ? 'primary' : 'neutral'"
          :variant="primary === 'platform' ? 'solid' : 'outline'"
          block
        />
        <UButton
          label="Use another account"
          color="neutral"
          :variant="primary === 'menu' ? 'outline' : 'ghost'"
          block
          :loading="signingOut"
          @click="useAnotherAccount"
        />
      </div>
    </template>
  </TaskFrame>
</template>
