<script setup lang="ts">
/**
 * Payments (`/admin/payments`, D102, the owner's frames): KHQR at the counter (step 10.15, D130), and
 * the riel rate cash payments in riel use.
 * The current rate and who set it when, beside a Change rate form; below, the history (the latest
 * 20, the current one marked). A new rate applies from now on; each payment keeps the rate it used.
 */
import type { TableColumn } from '@nuxt/ui'
import type { ExchangeRate } from '#shared/contracts/orders'
import { KHR_PER_USD_MAX, KHR_PER_USD_MIN, setExchangeRateSchema } from '#shared/contracts/orders'
import { useExchangeRateMutations, useExchangeRates } from '../composables/useExchangeRates'
import KhqrSettingsCard from './KhqrSettingsCard.vue'

const { data, error, loading, refresh } = useExchangeRates()
const { set } = useExchangeRateMutations()

const state = reactive<{ khrPerUsd: number | undefined }>({ khrPerUsd: undefined })
watch(() => data.value?.current?.khrPerUsd, (rate) => {
  if (state.khrPerUsd === undefined && rate) state.khrPerUsd = rate
}, { immediate: true })

const saving = computed(() => set.pending)
const unchanged = computed(() => state.khrPerUsd === data.value?.current?.khrPerUsd)

async function save() {
  if (state.khrPerUsd === undefined) return
  await set.execute({ khrPerUsd: state.khrPerUsd })
}

const riel = (n: number) => `៛${n.toLocaleString('en-US')}`
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

const columns: TableColumn<ExchangeRate>[] = [
  { accessorKey: 'effectiveFrom', header: 'Date' },
  { accessorKey: 'khrPerUsd', header: 'Rate' },
  { id: 'setBy', header: 'Set by' },
]
</script>

<template>
  <UDashboardPanel
    id="payments"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar title="Payments">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <KhqrSettingsCard />
        <ApiErrorAlert
          v-if="error"
          :error="error"
          title="Could not load the riel rate"
          @retry="refresh()"
        />
        <template v-else>
          <UCard
            as="section"
            aria-labelledby="riel-rate"
          >
            <template #header>
              <h2
                id="riel-rate"
                class="font-semibold text-highlighted"
              >
                Riel exchange rate
              </h2>
              <p class="text-sm text-muted">
                Used for cash payments in riel at the counter, rounded up to ៛100.
              </p>
            </template>

            <div class="grid gap-6 md:grid-cols-2 md:items-start">
              <div class="space-y-1 rounded-md bg-elevated/50 p-4">
                <p class="text-sm text-muted">
                  Current rate
                </p>
                <USkeleton
                  v-if="loading"
                  class="h-10 w-40"
                />
                <template v-else-if="data?.current">
                  <p class="text-4xl font-semibold text-highlighted tabular-nums">
                    {{ riel(data.current.khrPerUsd) }}
                    <span class="text-base font-normal text-muted">per $1</span>
                  </p>
                  <p class="text-sm text-muted">
                    Set by {{ data.current.setBy.name }} · {{ when(data.current.effectiveFrom) }}
                  </p>
                </template>
                <UAlert
                  v-else
                  color="warning"
                  variant="subtle"
                  icon="i-lucide-triangle-alert"
                  title="No rate yet"
                  description="The counter can't take cash in riel until a rate is set."
                />
              </div>

              <UForm
                id="rate-form"
                :schema="setExchangeRateSchema"
                :state="state"
                :disabled="saving"
                class="space-y-3"
                @submit="save"
              >
                <UFormField
                  label="Riel per $1"
                  name="khrPerUsd"
                  :help="`Between ${riel(KHR_PER_USD_MIN)} and ${riel(KHR_PER_USD_MAX)}. From now on; payments keep the rate they used.`"
                  required
                >
                  <UInputNumber
                    v-model="state.khrPerUsd"
                    :min="KHR_PER_USD_MIN"
                    :max="KHR_PER_USD_MAX"
                    :step="10"
                    class="w-full"
                  />
                </UFormField>
                <UButton
                  type="submit"
                  label="Save rate"
                  :loading="saving"
                  :disabled="unchanged || state.khrPerUsd === undefined"
                />
              </UForm>
            </div>
          </UCard>

          <UCard
            as="section"
            aria-labelledby="rate-history"
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <template #header>
              <h2
                id="rate-history"
                class="font-semibold text-highlighted"
              >
                Rate history
              </h2>
            </template>
            <UTable
              :data="data?.history ?? []"
              :columns="columns"
              :loading="loading"
              empty="No rate has been set yet."
            >
              <template #effectiveFrom-cell="{ row }">
                {{ when(row.original.effectiveFrom) }}
                <UBadge
                  v-if="row.index === 0"
                  label="Current"
                  color="success"
                  variant="subtle"
                  size="sm"
                  class="ms-2"
                />
              </template>
              <template #khrPerUsd-cell="{ row }">
                <span class="tabular-nums">{{ riel(row.original.khrPerUsd) }}</span>
              </template>
              <template #setBy-cell="{ row }">
                {{ row.original.setBy.name }}
              </template>
            </UTable>
          </UCard>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
