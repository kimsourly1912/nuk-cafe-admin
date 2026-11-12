<script setup lang="ts">
/**
 * The floor list and table list beside the 3D building (D273): the direct, accessible way to find
 * a floor or a table, and usable before (or without) the 3D view.
 */
import type { LayoutTable, ShopLayout } from '#shared/contracts/shop-layout'

const props = defineProps<{
  layout: ShopLayout
  tables: readonly LayoutTable[]
  focusedFloor: string | null
  insideFloor: string | null
  selectedTable: string | null
  canEnter: boolean
  section?: 'floors' | 'tables'
}>()

const emit = defineEmits<{
  focusFloor: [floorId: string]
  enterFloor: [floorId: string]
  selectTable: [tableId: string]
}>()

const floors = computed(() => props.layout.floors.filter(floor => floor.outline.length >= 3).reverse().map(floor => ({
  ...floor,
  tables: props.layout.placements
    .filter(placement => placement.floorId === floor.id)
    .map(placement => props.tables.find(table => table.id === placement.tableId))
    .filter((table): table is LayoutTable => !!table)
    .sort((a, b) => a.label.localeCompare(b.label)),
})))
const listed = computed(() => floors.value.filter(floor => !props.insideFloor || floor.id === props.insideFloor))
const unplaced = computed(() => {
  const placed = new Set(props.layout.placements.map(placement => placement.tableId))
  return props.tables.filter(table => !placed.has(table.id)).map(table => table.label)
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <section
      v-if="!insideFloor && section !== 'tables'"
      class="flex flex-col gap-1"
    >
      <h2 class="mb-1 text-sm font-semibold text-highlighted">
        Floors
      </h2>
      <div
        v-for="floor in floors"
        :key="floor.id"
        class="rounded-md"
        :class="floor.id === focusedFloor ? 'bg-primary/10' : ''"
      >
        <UButton
          :label="`${floor.name} floor`"
          icon="i-lucide-layers"
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
          :aria-pressed="floor.id === focusedFloor"
          @click="emit('focusFloor', floor.id)"
        >
          <template #trailing>
            <UBadge
              :label="`${floor.tables.length} ${floor.tables.length === 1 ? 'table' : 'tables'}`"
              color="neutral"
              variant="subtle"
              size="sm"
              class="ms-auto"
            />
          </template>
        </UButton>
        <UButton
          v-if="canEnter && floor.id === focusedFloor"
          label="Enter floor"
          trailing-icon="i-lucide-chevron-right"
          variant="link"
          size="sm"
          class="ms-8 mb-1"
          @click="emit('enterFloor', floor.id)"
        />
      </div>
    </section>

    <section
      v-if="section !== 'floors' || insideFloor"
      class="flex flex-col gap-3"
    >
      <h2 class="text-sm font-semibold text-highlighted">
        {{ insideFloor ? 'Tables on this floor' : 'Tables' }}
      </h2>
      <div
        v-for="floor in listed"
        :key="floor.id"
        class="flex flex-col gap-1"
      >
        <p
          v-if="!insideFloor"
          class="text-xs text-muted"
        >
          {{ floor.name }}
        </p>
        <p
          v-if="!floor.tables.length"
          class="text-sm text-muted"
        >
          No tables here.
        </p>
        <UButton
          v-for="table in floor.tables"
          :key="table.id"
          color="neutral"
          :variant="table.id === selectedTable ? 'soft' : 'ghost'"
          block
          class="justify-start"
          :aria-pressed="table.id === selectedTable"
          :data-testid="`list-table-${table.label}`"
          @click="emit('selectTable', table.id)"
        >
          <span class="inline-flex h-6 w-11 items-center justify-center rounded-full border border-primary text-xs font-semibold text-highlighted">{{ table.label }}</span>
          <span class="text-muted">{{ table.seats }} seats</span>
          <UIcon
            v-if="table.id === selectedTable"
            name="i-lucide-check"
            class="ms-auto size-4 text-primary"
          />
        </UButton>
      </div>
      <p
        v-if="unplaced.length"
        class="text-xs text-muted"
      >
        {{ unplaced.join(' and ') }} {{ unplaced.length === 1 ? 'is' : 'are' }} not on the map, so not in 3D.
      </p>
    </section>
  </div>
</template>
