<script setup lang="ts">
/**
 * The frame of a task-flow page (sign in, change password, the customer's account pages;
 * page-patterns §5, D84). From `sm` a centered `UCard` with the actions in its footer; on phones the
 * full screen: the title at the top, the fields, and the actions at the bottom in thumb reach, above
 * the home indicator (safe area). The footer isn't fixed: with the on-screen keyboard open it simply
 * follows the fields.
 *
 * CSS only (one card, restyled below `sm`), so a server-rendered page and the browser agree (D95).
 * The layout gives it the height: a flex parent at least the screen tall (`auth`, `account`).
 *
 * The submit button lives in the footer, outside the form: give the `UForm` an `id` and the button
 * `form="<id>"`, so Enter still submits.
 *
 * `wide` lifts the card's width from `sm:max-w-sm` to `sm:max-w-3xl` for a step with side-by-side
 * parts (the two-factor setup); it is still one column on phones.
 *
 * The `aside` slot puts a panel to the left of the card from `sm` (the account pages' picture, D97),
 * the two drawn as one card `sm:max-w-2xl` wide, at least `sm:min-h-128` tall; the panel fills
 * the height the card's content gives it and is hidden on phones. `height` raises that minimum for a
 * form that grows past it when its errors show (`tall`: 40rem, `taller`: 47rem), so the card keeps
 * one height and the photo (`object-cover`) isn't rescaled by it.
 *
 * @example
 * <TaskFrame>
 *   <template #header><h1>Sign in</h1></template>
 *   <UForm id="login-form" …>…</UForm>
 *   <template #footer><UButton type="submit" form="login-form" label="Sign in" block /></template>
 * </TaskFrame>
 */
defineProps<{ wide?: boolean, height?: 'tall' | 'taller' }>()
const ASIDE_MIN_HEIGHT = { tall: 'sm:min-h-160', taller: 'sm:min-h-188' } as const
</script>

<template>
  <div
    v-if="$slots.aside"
    class="flex w-full bg-default max-sm:flex-1 sm:max-w-2xl sm:overflow-hidden sm:rounded-lg sm:ring sm:ring-default"
    :class="height ? ASIDE_MIN_HEIGHT[height] : 'sm:min-h-128'"
  >
    <div class="relative w-2/5 shrink-0 max-sm:hidden">
      <div class="absolute inset-0">
        <slot name="aside" />
      </div>
    </div>
    <!-- The panel and this card are one card: the outer box draws its ring and corners. -->
    <UCard
      class="flex min-w-0 flex-1 flex-col rounded-none ring-0"
      :ui="{ body: 'flex-1', footer: 'space-y-2 max-sm:pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    >
      <template
        v-if="$slots.header"
        #header
      >
        <slot name="header" />
      </template>
      <slot />
      <template
        v-if="$slots.footer"
        #footer
      >
        <slot name="footer" />
      </template>
    </UCard>
  </div>
  <UCard
    v-else
    class="w-full max-sm:flex max-sm:flex-1 max-sm:flex-col max-sm:rounded-none max-sm:ring-0"
    :class="wide ? 'sm:max-w-3xl' : 'sm:max-w-sm'"
    :ui="{ body: 'max-sm:flex-1', footer: 'space-y-2 max-sm:pb-[max(env(safe-area-inset-bottom),1rem)]' }"
  >
    <template
      v-if="$slots.header"
      #header
    >
      <slot name="header" />
    </template>
    <slot />
    <template
      v-if="$slots.footer"
      #footer
    >
      <slot name="footer" />
    </template>
  </UCard>
</template>
