<script setup lang="ts">
/**
 * The add-on groups this item offers, in order (D61): each with the library's rules or this
 * item's own, and a price per add-on (one that differs from the library's is this item's own).
 * Groups come from the Add-ons library; field names match the form (`addOnGroups.<i>.…`).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import { MAX_ITEM_MODIFIER_GROUPS } from '#shared/contracts/menu-items'
import { describeRules, useModifierGroupOptions } from '~/features/modifier-groups'
import { addOnGroupFromLibrary } from '../schemas/item-form'
import type { FormAddOnGroup } from '../schemas/item-form'

defineProps<{ disabled?: boolean }>()

const groups = defineModel<FormAddOnGroup[]>({ required: true })

const { data: library, error, refresh } = useModifierGroupOptions()

const addItems = computed<DropdownMenuItem[]>(() => library.value
  .filter(g => g.status === 'active' && !groups.value.some(chosen => chosen.id === g.id))
  .map(g => ({ label: g.name, onSelect: () => groups.value.push(addOnGroupFromLibrary(g)) })))

/** The library's rules now (the item keeps what it read if the library isn't loaded). */
function libraryRules(group: FormAddOnGroup) {
  const current = library.value.find(g => g.id === group.id)
  return describeRules(current?.minSelect ?? group.groupMinSelect, current ? current.maxSelect : group.groupMaxSelect)
}

function setOwnRules(group: FormAddOnGroup, own: boolean) {
  group.ownRules = own
  // Start from the library's rules, so switching on changes nothing until edited.
  if (own) {
    group.minSelect = group.groupMinSelect
    group.maxSelect = group.groupMaxSelect
  }
}

function move(index: number, by: -1 | 1) {
  const list = [...groups.value]
  const [group] = list.splice(index, 1)
  list.splice(index + by, 0, group!)
  groups.value = list
}

/** This item's own price: it differs from the library's (sent as an override, D61). */
const ownPrice = (addOn: FormAddOnGroup['addOns'][number]) => toMinor(addOn.price ?? 0) !== addOn.defaultPriceMinor
</script>

<template>
  <div class="space-y-3">
    <p
      v-if="!groups.length"
      class="text-sm text-muted"
    >
      No add-ons. Add a group from the Add-ons library, e.g. milk or extra shots.
    </p>

    <section
      v-for="(group, i) in groups"
      :key="group.id"
      :aria-label="`Add-on group ${group.name}`"
      class="space-y-3 rounded-md border border-default p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <h4 class="flex items-center gap-2 font-medium text-highlighted">
          {{ group.name }}
          <UBadge
            v-if="group.status === 'archived'"
            label="Archived"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </h4>
        <div class="flex gap-1">
          <UButton
            icon="i-lucide-arrow-up"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Move ${group.name} up`"
            :disabled="disabled || i === 0"
            @click="move(i, -1)"
          />
          <UButton
            icon="i-lucide-arrow-down"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Move ${group.name} down`"
            :disabled="disabled || i === groups.length - 1"
            @click="move(i, 1)"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Remove ${group.name}`"
            :disabled="disabled"
            @click="groups.splice(i, 1)"
          />
        </div>
      </div>

      <div class="space-y-2">
        <UCheckbox
          :model-value="group.ownRules"
          :disabled="disabled"
          :label="`Own rules for this item (library: ${libraryRules(group)})`"
          @update:model-value="value => setOwnRules(group, !!value)"
        />
        <div
          v-if="group.ownRules"
          class="flex flex-wrap gap-3"
        >
          <UFormField
            label="At least"
            :name="`addOnGroups.${i}.minSelect`"
          >
            <UInputNumber
              v-model="group.minSelect"
              :min="0"
              :disabled="disabled"
              :aria-label="`At least, ${group.name}`"
              class="w-28"
            />
          </UFormField>
          <UFormField
            label="At most"
            :name="`addOnGroups.${i}.maxSelect`"
            :hint="group.maxSelect === null ? 'No limit' : undefined"
          >
            <UInputNumber
              :model-value="group.maxSelect"
              :min="1"
              :disabled="disabled"
              :aria-label="`At most, ${group.name}`"
              placeholder="No limit"
              class="w-28"
              @update:model-value="value => group.maxSelect = value ?? null"
            />
          </UFormField>
        </div>
        <p class="text-sm text-muted">
          {{ group.ownRules ? describeRules(group.minSelect, group.maxSelect) : libraryRules(group) }}
        </p>
      </div>

      <ul class="divide-y divide-default">
        <li
          v-for="(addOn, j) in group.addOns"
          :key="addOn.id"
          class="flex items-center justify-between gap-3 py-2"
        >
          <span class="text-sm">
            {{ addOn.name }}
            <span
              v-if="addOn.isDefault"
              class="text-muted"
            >(pre-selected)</span>
            <span
              v-if="addOn.status === 'archived'"
              class="text-muted"
            >(archived)</span>
          </span>
          <UFormField :name="`addOnGroups.${i}.addOns.${j}.price`">
            <div class="flex items-center gap-2">
              <span
                v-if="ownPrice(addOn)"
                class="text-xs text-muted"
              >Library: {{ formatMinor(addOn.defaultPriceMinor) }}</span>
              <UInputNumber
                :model-value="addOn.price ?? null"
                :format-options="PRICE_FORMAT"
                :min="0"
                :step="0.01"
                :disabled="disabled"
                :aria-label="`Price of ${addOn.name} in ${group.name}`"
                class="w-28"
                @update:model-value="value => addOn.price = value ?? undefined"
              />
            </div>
          </UFormField>
        </li>
      </ul>
    </section>

    <ApiErrorAlert
      v-if="error"
      :error="error"
      title="Could not load the Add-ons library"
      @retry="refresh()"
    />
    <UDropdownMenu
      v-else
      :items="addItems"
      :disabled="disabled || groups.length >= MAX_ITEM_MODIFIER_GROUPS || !addItems.length"
    >
      <UButton
        label="Add add-on group"
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="disabled || groups.length >= MAX_ITEM_MODIFIER_GROUPS || !addItems.length"
      />
    </UDropdownMenu>
  </div>
</template>
