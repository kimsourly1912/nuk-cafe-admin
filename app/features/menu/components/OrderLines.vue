<script setup lang="ts">
/**
 * The lines of the order before checkout (D93, D124; the card's shape from the owner's frame, D128):
 * each line a soft card with the photo, the name, the choices and the line's total; under a divider,
 * "Add a note" on the left and the trash and `<QuantityStepper>` on the right (from 1: removing is
 * the trash's job, so "−" can't remove a line by accident). A line whose item left the menu or sold
 * out says so, doesn't count, and can only be removed. The panel or sheet around it keeps its header
 * and totals in view. The note travels with the line to Review order.
 *
 * Motion (D263, D268): a line added fades in and is brought into view; a line removed fades out while
 * the ones below slide up (`useListTransition`), and the panel's height and totals travel with them
 * (`AnimatedHeight`). A note box opens and closes by its own height. The list and "Your order is
 * empty" swap with a short fade. "Clear order" takes the lines out one after another (D264): the list
 * and its height stay until the last one has gone.
 */
import { usePreferredReducedMotion } from '@vueuse/core'
import { LINE_NOTE_MAX } from '#shared/contracts/orders'
import type { ResolvedCart } from '../utils/cart'
import { MAX_LINE_QUANTITY } from '../utils/cart'
import AnimatedHeight from './AnimatedHeight.vue'

const props = defineProps<{ cart: ResolvedCart }>()
const emit = defineEmits<{
  'set-quantity': [key: string, quantity: number]
  'set-note': [key: string, note: string]
}>()

const listTransition = useListTransition()
// The order emptied ("Clear order", the last trash): the list stays until its lines have gone.
// Decided from the data before the render that removes them (`pre`): the leave hooks run during
// that render, too late. Only the end changes reactive state: a change during the leave re-renders
// the group, and TransitionGroup cancels its rows' slide on the next update.
const holding = ref(false)
// The height stays a little longer than the list: until the empty state replaces it, so the panel
// goes straight to the empty state's height instead of closing and opening again.
const heightFrozen = ref(false)
let leaving = 0
watch(() => props.cart.lines.length, (count, previous) => {
  if (count > 0) heightFrozen.value = false
  if (count > 0 || previous === 0) return
  holding.value = true
  heightFrozen.value = true
  // Nothing left to leave (reduced motion removes rows at once): let the empty state show.
  nextTick(() => {
    if (leaving === 0) holding.value = false
  })
}, { flush: 'pre' })

function onLineLeaving() {
  leaving++
}

function onLineLeft() {
  leaving = Math.max(0, leaving - 1)
  if (leaving === 0) holding.value = false
}

const showList = computed(() => props.cart.lines.length > 0 || holding.value)

const reducedMotion = usePreferredReducedMotion()

/** A new line may land below the scroll: bring it into view, without moving anything if it shows. */
function revealLine(el: Element) {
  el.scrollIntoView({ block: 'nearest', behavior: reducedMotion.value === 'reduce' ? 'auto' : 'smooth' })
}

/** Lines whose note box was opened here; a line with a note shows it already. */
const notesOpen = ref(new Set<string>())

/** Kept open while typing, even when the text is cleared. */
function setNote(key: string, note: string) {
  notesOpen.value.add(key)
  emit('set-note', key, note)
}

/** Clears the note and closes its box; only emits when there was text to clear. */
function removeNote(line: ResolvedCart['lines'][number]) {
  notesOpen.value.delete(line.key)
  if (line.note) emit('set-note', line.key, '')
}
</script>

<template>
  <AnimatedHeight :frozen="heightFrozen">
    <Transition
      name="fade"
      mode="out-in"
      @after-leave="heightFrozen = false"
    >
      <div
        v-if="!showList"
        class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default px-4 py-8 text-center"
      >
        <UIcon
          name="i-lucide-shopping-bag"
          class="size-8 text-dimmed"
        />
        <p class="font-medium text-highlighted">
          Your order is empty
        </p>
        <p class="text-sm text-muted">
          Add items from the menu.
        </p>
      </div>

      <TransitionGroup
        v-else
        tag="ul"
        class="relative flex flex-col gap-3"
        aria-label="Items in your order"
        v-bind="listTransition"
        @before-leave="onLineLeaving"
        @after-leave="onLineLeft"
        @after-enter="revealLine"
      >
        <li
          v-for="line in cart.lines"
          :key="line.key"
          :aria-label="line.name"
          class="scroll-my-4"
        >
          <UCard
            variant="subtle"
            :ui="{ body: 'p-3 sm:p-3' }"
          >
            <div class="flex gap-3">
              <MenuItemImage
                :image="line.image"
                :src="line.imageUrl"
                usage="card"
                class="size-14 rounded-md"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <p
                    class="min-w-0 font-medium"
                    :class="line.available ? 'text-highlighted' : 'text-muted line-through'"
                  >
                    {{ line.name }}
                  </p>
                  <span
                    v-if="line.available"
                    class="flex shrink-0 flex-col items-end tabular-nums"
                  >
                    <span class="font-semibold text-highlighted">{{ formatMinor(line.unitPriceMinor * line.quantity) }}</span>
                    <s
                      v-if="line.regularUnitPriceMinor !== null"
                      class="text-xs text-muted"
                    ><span class="sr-only">was </span>{{ formatMinor(line.regularUnitPriceMinor * line.quantity) }}</s>
                  </span>
                </div>
                <p
                  v-if="line.detail"
                  class="text-sm text-muted"
                >
                  {{ line.detail }}
                </p>
                <UBadge
                  v-if="!line.available"
                  label="No longer available"
                  color="warning"
                  variant="subtle"
                  size="sm"
                  class="mt-1"
                />
              </div>
            </div>

            <USeparator class="my-3" />

            <div class="flex items-center justify-between gap-2">
              <UButton
                v-if="line.available && !line.note && !notesOpen.has(line.key)"
                label="Add a note"
                icon="i-lucide-notebook-pen"
                color="neutral"
                variant="link"
                size="sm"
                class="px-0"
                @click="notesOpen.add(line.key)"
              />
              <UButton
                v-else-if="line.available"
                label="Remove note"
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="sm"
                class="px-0"
                @click="removeNote(line)"
              />
              <span v-else />
              <div class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-trash-2"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="`Remove ${line.name}`"
                  @click="emit('set-quantity', line.key, 0)"
                />
                <QuantityStepper
                  v-if="line.available"
                  :model-value="line.quantity"
                  :max="MAX_LINE_QUANTITY"
                  :label="line.name"
                  size="sm"
                  @update:model-value="value => emit('set-quantity', line.key, value)"
                />
              </div>
            </div>

            <!-- Grid-row trick: opens and closes by the box's own height, without measuring it. -->
            <div
              v-if="line.available"
              class="grid transition-[grid-template-rows,opacity] duration-200 ease-move motion-reduce:transition-none"
              :class="line.note || notesOpen.has(line.key) ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
              :inert="!line.note && !notesOpen.has(line.key)"
            >
              <div class="min-h-0 overflow-hidden">
                <UFormField
                  :label="`Note for ${line.name}`"
                  :help="`${(line.note ?? '').length}/${LINE_NOTE_MAX}`"
                  :ui="{ label: 'sr-only', help: 'text-end' }"
                  class="pt-2"
                >
                  <UTextarea
                    :model-value="line.note ?? ''"
                    :maxlength="LINE_NOTE_MAX"
                    :rows="2"
                    autoresize
                    placeholder="Add a note (optional), e.g. Less ice"
                    class="w-full"
                    @update:model-value="value => setNote(line.key, String(value ?? ''))"
                  />
                </UFormField>
              </div>
            </div>
          </UCard>
        </li>
      </TransitionGroup>
    </Transition>
  </AnimatedHeight>
</template>
