<script setup lang="ts">
/**
 * `/table/<token>`: where a table's QR code leads (D91, D93). The token names the cafe, the branch
 * and the table (`GET /api/tables/{token}`, global: D140); this tab then orders for that table and
 * goes to the menu. A token that doesn't work (rotated, archived table or branch, mistyped) says so:
 * the reason is never told (the server answers 404 for all of them). Its cafe is unknown then, so
 * there's no link to any cafe's menu (D220): the staff help, or the cafe's own link.
 */
import type { ScannedTable } from '#shared/contracts/branches'
import { useTableContext } from '../composables/useShopMenu'

const route = useRoute()
const { setTable } = useTableContext()
const token = computed(() => String(route.params.token ?? ''))
const { data, error, refresh } = useApiQuery('menu:table', () => apiFetch<ScannedTable>(`/tables/${encodeURIComponent(token.value)}`))

watch(data, (scanned) => {
  if (!scanned) return
  setTable(scanned, token.value)
  // The printed code found its cafe: on to that cafe's menu (D141).
  navigateTo(tenantUrl(scanned.cafe.slug, '/'), { replace: true })
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
        Ask the staff for help, or open the cafe's menu from its own link.
      </p>
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
