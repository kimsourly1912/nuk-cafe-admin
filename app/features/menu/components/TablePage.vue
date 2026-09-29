<script setup lang="ts">
/**
 * `/table/<token>`: where a table's QR code leads (D91, D93). The token names the branch and the
 * table (`GET /api/public/tables/{token}`); this tab then orders for that table and goes to the
 * menu. A token that doesn't work (rotated, archived table or branch, mistyped) says so and offers
 * pickup instead: the reason is never told (the server answers 404 for all of them).
 */
import type { PublicTable } from '#shared/contracts/branches'
import { useTableContext } from '../composables/useShopMenu'

const route = useRoute()
const { setTable } = useTableContext()
const token = computed(() => String(route.params.token ?? ''))
const { data, error, refresh } = useApiQuery('menu:table', () => apiFetch<PublicTable>(`/public/tables/${encodeURIComponent(token.value)}`))

watch(data, (scanned) => {
  if (!scanned) return
  setTable(scanned)
  navigateTo('/', { replace: true })
}, { immediate: true })

const notFound = computed(() => error.value?.kind === 'not_found')
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">
    <template v-if="notFound">
      <UIcon
        name="i-lucide-qr-code"
        class="size-10 text-muted"
      />
      <h1 class="text-xl font-semibold text-highlighted">
        This table's QR code doesn't work
      </h1>
      <p class="max-w-sm text-muted">
        Ask the staff for help, or order for pickup instead.
      </p>
      <UButton
        label="Order for pickup"
        to="/"
      />
    </template>
    <div
      v-else-if="error"
      class="w-full max-w-sm"
    >
      <ApiErrorAlert
        :error="error"
        title="Could not open your table"
        @retry="refresh()"
      />
    </div>
    <template v-else>
      <UIcon
        name="i-lucide-loader-circle"
        class="size-8 animate-spin text-muted"
      />
      <p
        class="text-muted"
        role="status"
      >
        Opening your table…
      </p>
    </template>
  </div>
</template>
