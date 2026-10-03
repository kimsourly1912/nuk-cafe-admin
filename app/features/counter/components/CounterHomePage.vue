<script setup lang="ts">
/**
 * The counter's home (`/counter`, D102): someone who works at one branch goes straight to its
 * queue; someone at several (or an admin) picks one.
 */
import { useCounterSession } from '../composables/useCounterSession'

const tenantPath = useTenantPath()

const { user, signOut } = useCounterSession()
const branches = computed(() => user.value?.branches ?? [])

watchEffect(() => {
  if (branches.value.length === 1) void navigateTo(tenantPath(`/counter/${branches.value[0]!.id}`), { replace: true })
})
</script>

<template>
  <TaskFrame v-if="branches.length !== 1">
    <template #header>
      <div class="space-y-1">
        <h1 class="text-lg font-semibold">
          Choose a branch
        </h1>
        <p class="text-sm text-muted">
          {{ user?.email }}
        </p>
      </div>
    </template>

    <ul
      class="space-y-2"
      aria-label="Branches"
    >
      <li
        v-for="branch in branches"
        :key="branch.id"
      >
        <UButton
          :to="tenantPath(`/counter/${branch.id}`)"
          :label="branch.name"
          :trailing-icon="'i-lucide-chevron-right'"
          color="neutral"
          variant="outline"
          size="lg"
          block
          class="justify-between"
        />
      </li>
    </ul>

    <template #footer>
      <div class="flex justify-center">
        <UButton
          label="Sign out"
          color="neutral"
          variant="link"
          @click="signOut()"
        />
      </div>
    </template>
  </TaskFrame>
</template>
