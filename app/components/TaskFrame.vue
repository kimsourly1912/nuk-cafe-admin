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
 * @example
 * <TaskFrame>
 *   <template #header><h1>Sign in</h1></template>
 *   <UForm id="login-form" …>…</UForm>
 *   <template #footer><UButton type="submit" form="login-form" label="Sign in" block /></template>
 * </TaskFrame>
 */
</script>

<template>
  <UCard
    class="w-full sm:max-w-sm max-sm:flex max-sm:flex-1 max-sm:flex-col max-sm:rounded-none max-sm:ring-0"
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
