<script setup lang="ts">
/**
 * An item's detail (D93): a dialog from `sm`, a bottom sheet on phones. The customer picks one
 * value per option set (the version, D44) and the add-ons each group allows, then a quantity; the
 * footer's button adds it with its total ("Add to order · $5.50"). While a required group isn't
 * complete the button says what's missing ("Choose Milk") and takes the customer there. Values
 * that only lead to sold-out versions are disabled. Adding is refused while the branch is closed.
 */
import { AppDrawer, UModal } from '#components'
import type { PublicMenuItem, PublicMenuModifierGroup } from '#shared/contracts/public-menu'
import { MAX_LINE_QUANTITY } from '../utils/cart'
import type { Selection } from '../utils/selection'
import { chooseValue, chosenModifierIds, defaultSelection, groupRule, isValueOrderable, selectionProblems, toggleModifier, unitPriceOf, variationOf } from '../utils/selection'

const props = defineProps<{
  item: PublicMenuItem
  closed: boolean
  /** Why the branch is closed ("Opens today at 7:00 AM"), shown under the button. */
  closedNote?: string
}>()
const emit = defineEmits<{ add: [line: { variationId: string, modifierIds: string[], quantity: number }] }>()
const open = defineModel<boolean>('open', { default: false })

const { isCompact } = useLayoutContext()
const Shell = computed(() => (isCompact.value ? AppDrawer : UModal))

const selection = ref<Selection>(defaultSelection(props.item))
const quantity = ref(1)
/** Set once the customer tried to add an incomplete choice: the missing groups say so. */
const revealed = ref(false)

// Every opening starts fresh (the same item again too: "Add another" is a new choice).
watch([open, () => props.item], ([isOpen]) => {
  if (!isOpen) return
  selection.value = defaultSelection(props.item)
  quantity.value = 1
  revealed.value = false
})

const problems = computed(() => selectionProblems(props.item, selection.value))
const problemOf = (target: string) => (revealed.value ? problems.value.find(p => p.target === target)?.message : undefined)
const total = computed(() => unitPriceOf(props.item, selection.value) * quantity.value)

const buttonLabel = computed(() => {
  if (props.item.soldOut) return 'Sold out'
  if (props.closed) return 'Closed now'
  return problems.value[0]?.action ?? `Add to order · ${formatMinor(total.value)}`
})

/** One option set as radio items: its values, disabled when they'd only lead to sold-out versions. */
function valueItems(setIndex: number) {
  const set = props.item.optionSets[setIndex]!
  const single = props.item.optionSets.length === 1
  return set.values.map((value) => {
    const orderable = isValueOrderable(props.item, selection.value, setIndex, value.id)
    // With one option set a value is a version: its price is known. With two it depends on both.
    const version = single ? props.item.variations.find(v => v.valueIds[0] === value.id) : undefined
    return {
      label: value.name,
      value: value.id,
      disabled: !orderable,
      description: !orderable && single ? 'Sold out' : version ? formatMinor(version.priceMinor) : undefined,
    }
  })
}

const priceDelta = (minor: number) => (minor > 0 ? `+${formatMinor(minor)}` : undefined)
const chosenIn = (group: PublicMenuModifierGroup) => selection.value.modifiers[group.id] ?? []
const isRadioGroup = (group: PublicMenuModifierGroup) => group.minSelect === 1 && group.maxSelect === 1

function toggle(group: PublicMenuModifierGroup, modifierId: string) {
  selection.value = { ...selection.value, modifiers: { ...selection.value.modifiers, [group.id]: toggleModifier(group, chosenIn(group), modifierId) } }
}
function pickOne(group: PublicMenuModifierGroup, modifierId: string) {
  selection.value = { ...selection.value, modifiers: { ...selection.value.modifiers, [group.id]: [modifierId] } }
}

function submit() {
  if (props.item.soldOut || props.closed) return
  const problem = problems.value[0]
  if (problem) {
    revealed.value = true
    const section = document.getElementById(`choice-${props.item.id}-${problem.target}`)
    section?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    section?.focus({ preventScroll: true })
    return
  }
  const version = variationOf(props.item, selection.value)
  if (!version) return
  emit('add', { variationId: version.id, modifierIds: chosenModifierIds(props.item, selection.value), quantity: quantity.value })
  open.value = false
}
</script>

<template>
  <component
    :is="Shell"
    v-model:open="open"
    :title="item.name"
    :description="item.description || undefined"
    :ui="isCompact ? { content: 'max-h-[92dvh]', body: 'overflow-y-auto' } : { content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="space-y-6">
        <img
          v-if="item.imageUrl"
          :src="item.imageUrl"
          alt=""
          class="h-44 w-full rounded-lg object-cover sm:h-56"
        >
        <p class="font-semibold text-highlighted">
          {{ formatMinor(unitPriceOf(item, selection)) }}
        </p>

        <p
          v-if="problemOf('version')"
          class="text-sm text-error"
        >
          {{ problemOf('version') }}
        </p>

        <fieldset
          v-for="(set, setIndex) in item.optionSets"
          :key="set.id"
          class="space-y-2"
        >
          <legend class="flex w-full items-center justify-between gap-2">
            <span class="font-medium text-highlighted">{{ set.name }}</span>
            <UBadge
              label="Required · choose 1"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </legend>
          <URadioGroup
            :model-value="selection.values[setIndex]"
            :items="valueItems(setIndex)"
            :aria-label="set.name"
            @update:model-value="value => selection = chooseValue(item, selection, setIndex, String(value))"
          />
        </fieldset>

        <fieldset
          v-for="group in item.modifierGroups"
          :id="`choice-${item.id}-${group.id}`"
          :key="group.id"
          tabindex="-1"
          class="space-y-2 rounded-md outline-none"
          :aria-describedby="problemOf(group.id) ? `problem-${item.id}-${group.id}` : undefined"
        >
          <legend class="flex w-full items-center justify-between gap-2">
            <span class="font-medium text-highlighted">{{ group.name }}</span>
            <UBadge
              :label="groupRule(group)"
              :color="problemOf(group.id) ? 'error' : 'neutral'"
              variant="subtle"
              size="sm"
            />
          </legend>
          <p
            v-if="problemOf(group.id)"
            :id="`problem-${item.id}-${group.id}`"
            class="text-sm text-error"
          >
            {{ problemOf(group.id) }}
          </p>
          <URadioGroup
            v-if="isRadioGroup(group)"
            :model-value="chosenIn(group)[0]"
            :items="group.modifiers.map(m => ({ label: m.name, value: m.id, description: priceDelta(m.priceDeltaMinor) }))"
            :aria-label="group.name"
            @update:model-value="value => pickOne(group, String(value))"
          />
          <div
            v-else
            class="space-y-2"
          >
            <UCheckbox
              v-for="modifier in group.modifiers"
              :key="modifier.id"
              :model-value="chosenIn(group).includes(modifier.id)"
              :label="modifier.name"
              :description="priceDelta(modifier.priceDeltaMinor)"
              :disabled="!chosenIn(group).includes(modifier.id) && group.maxSelect !== null && group.maxSelect !== 1 && chosenIn(group).length >= group.maxSelect"
              @update:model-value="toggle(group, modifier.id)"
            />
          </div>
        </fieldset>
      </div>
    </template>

    <template #footer>
      <div class="w-full space-y-2">
        <div class="flex w-full items-center gap-3">
          <UInputNumber
            v-model="quantity"
            :min="1"
            :max="MAX_LINE_QUANTITY"
            :disabled="item.soldOut || closed"
            aria-label="Quantity"
            class="w-32 shrink-0"
          />
          <UButton
            :label="buttonLabel"
            :disabled="item.soldOut || closed"
            block
            class="flex-1"
            @click="submit"
          />
        </div>
        <p
          v-if="closed && closedNote"
          class="text-center text-sm text-muted"
        >
          {{ closedNote }}
        </p>
      </div>
    </template>
  </component>
</template>
