<script setup lang="ts">
/**
 * The price grid: one version per combination of the option sets' values (D60). Without option
 * sets it's a single price; with one set, a row per value; with two, rows for the first set and
 * columns for the second. Each version has a price and a switch ("sold"): a version that's on
 * needs a price. Field names match the form (`grid.<i>.price`) so errors show on their cell.
 */
import type { FormOptionSet, GridCell } from '../schemas/item-form'

const props = defineProps<{
  sets: FormOptionSet[]
  disabled?: boolean
}>()

const grid = defineModel<GridCell[]>({ required: true })

/** Rows × columns of cell indexes: the grid lists the first set's values slowest. */
const columns = computed(() => props.sets[1]?.values ?? [])
const rows = computed(() => {
  const width = Math.max(columns.value.length, 1)
  const labels = props.sets[0]?.values.map(v => v.name) ?? ['']
  return labels.map((label, r) => ({ label, cells: Array.from({ length: width }, (_, c) => r * width + c) }))
})

function setPrice(index: number, value: number | null | undefined) {
  grid.value[index]!.price = value ?? undefined
}
</script>

<template>
  <!-- No option sets: one price. -->
  <UFormField
    v-if="!sets.length"
    label="Price"
    name="grid.0.price"
    required
  >
    <UInputNumber
      :model-value="grid[0]?.price ?? null"
      :format-options="PRICE_FORMAT"
      :min="0"
      :step="0.01"
      :disabled="disabled"
      aria-label="Price"
      class="w-40"
      @update:model-value="value => setPrice(0, value)"
    />
  </UFormField>

  <div
    v-else
    class="overflow-x-auto rounded-md border border-default"
  >
    <table class="w-full text-sm">
      <thead class="bg-elevated/50">
        <tr>
          <th
            scope="col"
            class="px-3 py-2 text-left font-medium text-muted"
          >
            {{ sets.map(set => set.name).join(' × ') }}
          </th>
          <th
            v-for="column in (sets[1] ? columns : [{ id: 'price', name: 'Price' }])"
            :key="column.id"
            scope="col"
            class="px-3 py-2 text-left font-medium"
          >
            {{ column.name }}
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-default">
        <tr
          v-for="row in rows"
          :key="row.label"
        >
          <th
            scope="row"
            class="px-3 py-2 text-left font-medium"
          >
            {{ row.label }}
          </th>
          <td
            v-for="index in row.cells"
            :key="grid[index]?.key ?? index"
            class="px-3 py-2 align-top"
          >
            <UFormField
              v-if="grid[index]"
              :name="`grid.${index}.price`"
            >
              <div class="flex items-center gap-2">
                <USwitch
                  :model-value="grid[index]!.on"
                  :disabled="disabled"
                  :aria-label="`Sell ${grid[index]!.label}`"
                  size="sm"
                  @update:model-value="value => grid[index]!.on = value"
                />
                <UInputNumber
                  :model-value="grid[index]!.price ?? null"
                  :format-options="PRICE_FORMAT"
                  :min="0"
                  :step="0.01"
                  :disabled="disabled || !grid[index]!.on"
                  :aria-label="`Price of ${grid[index]!.label}`"
                  placeholder="Off"
                  class="w-32"
                  @update:model-value="value => setPrice(index, value)"
                />
              </div>
            </UFormField>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <UFormField name="grid" />
</template>
