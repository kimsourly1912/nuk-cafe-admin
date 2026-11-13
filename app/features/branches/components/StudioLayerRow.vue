<script setup lang="ts">
/**
 * One row of Studio's Layers list (ISS-021, like Figma's): a floor or a piece on it. Click selects
 * (the editor reads Shift for a range and Ctrl/⌘ to add or take out), a double-click renames in
 * place, pointing at it outlines it on the plan, and the eye and lock show on hover, or always
 * when on. The row keeps no state but the name being typed; the editor does the rest.
 */
const { label, icon, selected = false, current = false, hidden = false, locked = false, renameable = true, depth = 0, testid } = defineProps<{
  label: string
  icon: string
  /** Picked on the plan. */
  selected?: boolean
  /** The floor shown (a floor row). */
  current?: boolean
  hidden?: boolean
  locked?: boolean
  renameable?: boolean
  /** 0 for a floor, 1 for what is on it. */
  depth?: number
  /** On the row's button (the part a click selects); the whole row is `${testid}-row`. */
  testid?: string
}>()
const emit = defineEmits<{
  select: [event: MouseEvent]
  rename: [name: string]
  hidden: [on: boolean]
  locked: [on: boolean]
  hover: [on: boolean]
}>()

const editing = ref<string | null>(null)
const nameInput = useTemplateRef<{ inputRef?: HTMLInputElement }>('nameInput')

function startRename() {
  if (!renameable) return
  editing.value = label
  void nextTick(() => nameInput.value?.inputRef?.select())
}

function commit() {
  const name = editing.value?.trim()
  editing.value = null
  if (name && name !== label) emit('rename', name)
}
</script>

<template>
  <div
    class="group flex min-h-8 items-center gap-1 rounded-md pe-1 text-sm"
    :class="[
      selected ? 'bg-primary/10 text-highlighted' : current ? 'bg-elevated text-highlighted' : 'text-default hover:bg-elevated/60',
      depth ? 'ps-5' : 'ps-1',
    ]"
    :data-testid="testid && `${testid}-row`"
    :data-hidden="hidden ? 'yes' : undefined"
    :data-locked="locked ? 'yes' : undefined"
    @pointerenter="emit('hover', true)"
    @pointerleave="emit('hover', false)"
  >
    <UInput
      v-if="editing !== null"
      ref="nameInput"
      v-model="editing"
      size="sm"
      :maxlength="40"
      :aria-label="`New name for ${label}`"
      autofocus
      class="min-w-0 flex-1"
      @keydown.enter.prevent="commit"
      @keydown.esc.stop.prevent="editing = null"
      @blur="commit"
    />
    <button
      v-else
      type="button"
      class="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1"
      :class="hidden && 'opacity-50'"
      :aria-pressed="selected || current"
      :data-testid="testid"
      @click="emit('select', $event)"
      @dblclick="startRename"
    >
      <UIcon
        :name="icon"
        class="size-4 shrink-0 text-muted"
      />
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <slot name="trailing" />
    </button>
    <UTooltip :text="locked ? 'Unlock' : 'Lock'">
      <UButton
        :icon="locked ? 'i-lucide-lock' : 'i-lucide-lock-open'"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="`${locked ? 'Unlock' : 'Lock'} ${label}`"
        :aria-pressed="locked"
        :class="locked ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'"
        data-testid="layer-lock"
        @click="emit('locked', !locked)"
      />
    </UTooltip>
    <UTooltip :text="hidden ? 'Show' : 'Hide'">
      <UButton
        :icon="hidden ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="`${hidden ? 'Show' : 'Hide'} ${label}`"
        :aria-pressed="hidden"
        :class="hidden ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'"
        data-testid="layer-eye"
        @click="emit('hidden', !hidden)"
      />
    </UTooltip>
  </div>
</template>
