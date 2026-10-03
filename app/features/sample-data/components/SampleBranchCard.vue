<script setup lang="ts">
/**
 * Branch hours and tables (D94): sample opening hours (replacing the branch's, asked first when it
 * has some) and 12 tables with QR codes (labels already in use are kept). With several branches
 * (staging has two), a picker chooses which one.
 */
import type { SampleDataState } from '#shared/contracts/sample-data'
import { branchSummary } from '../utils/state'

const tenantPath = useTenantPath()

const props = defineProps<{
  state: SampleDataState
  loading: boolean
  busy: boolean
  error?: string
}>()
const emit = defineEmits<{ load: [branchId: string] }>()

const branchId = ref(props.state.branches[0]?.id)
const branch = computed(() => props.state.branches.find(b => b.id === branchId.value))
const loadedBefore = computed(() => !!branch.value && (branch.value.hoursSet || branch.value.tables > 0))

const confirm = useConfirm()
async function load() {
  if (!branch.value) return
  if (branch.value.hoursSet && !await confirm({
    title: 'Replace the opening hours?',
    description: `${branch.value.name}'s weekly hours become the sample hours. Tables with the same labels are kept.`,
    confirmLabel: 'Replace hours',
  })) return
  emit('load', branch.value.id)
}
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="sample-branch"
  >
    <div class="space-y-1">
      <h2
        id="sample-branch"
        class="text-lg font-semibold text-highlighted"
      >
        Branch hours and tables
      </h2>
      <p class="text-sm text-muted">
        Replaces the weekly opening hours and adds the sample tables that are missing.
      </p>
    </div>

    <ul class="mt-4 space-y-1 text-sm">
      <li><span class="font-medium text-highlighted">Mon–Fri</span><span class="text-muted"> · 7:00 AM – 9:00 PM</span></li>
      <li><span class="font-medium text-highlighted">Sat–Sun</span><span class="text-muted"> · 8:00 AM – 10:00 PM</span></li>
      <li><span class="font-medium text-highlighted">12 tables</span><span class="text-muted"> · T01–T08 Main floor, P01–P04 Patio, with QR codes</span></li>
      <li class="text-muted">
        Tables whose label is already in use are kept.
      </li>
    </ul>

    <USeparator class="my-4" />

    <p
      v-if="!state.branches.length"
      class="text-sm text-muted"
    >
      There is no active branch.
    </p>
    <div
      v-else
      class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <RecordSelect
          v-if="state.branches.length > 1"
          v-model="branchId"
          :items="state.branches.map(b => ({ label: b.name, value: b.id }))"
          noun="branches"
          aria-label="Branch"
          :disabled="busy || loading"
          class="sm:w-48"
        />
        <p
          v-if="branch"
          class="flex items-center gap-2 text-sm"
        >
          <UIcon
            :name="loadedBefore ? 'i-lucide-circle-check' : 'i-lucide-circle'"
            class="size-4 shrink-0"
            :class="loadedBefore ? 'text-success' : 'text-dimmed'"
          />
          <span>{{ state.branches.length > 1 ? '' : `${branch.name}: ` }}{{ branchSummary(branch) }}</span>
          <UButton
            v-if="loadedBefore"
            label="Open Branch"
            :to="tenantPath(`/admin/branches/${branch.id}`)"
            variant="link"
            class="px-0"
          />
        </p>
      </div>
      <UButton
        :label="loading ? 'Loading…' : loadedBefore ? 'Load again' : 'Load hours and tables'"
        :loading="loading"
        :disabled="busy || !branch"
        :variant="loadedBefore ? 'outline' : 'solid'"
        :color="loadedBefore ? 'neutral' : 'primary'"
        icon="i-lucide-clock"
        class="justify-center max-sm:w-full"
        @click="load"
      />
    </div>
    <UAlert
      v-if="error && !loading"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Loading stopped"
      :description="error"
      class="mt-3"
    />
  </UCard>
</template>
