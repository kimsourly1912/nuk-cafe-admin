<script setup lang="ts">
/**
 * The frame of a task-flow page (sign in, change password; page-patterns §5, D84). From `sm` a
 * centered `UCard` with the actions in its footer; on phones the full screen: the title at the top,
 * the fields, and the actions at the bottom in thumb reach, above the home indicator (safe area).
 * The footer isn't fixed: with the on-screen keyboard open it simply follows the fields.
 *
 * The submit button lives in the footer, outside the form: give the `UForm` an `id` and the button
 * `form="<id>"`, so Enter still submits.
 *
 * @example
 * <AuthFrame>
 *   <template #header><h1>Sign in</h1></template>
 *   <UForm id="login-form" …>…</UForm>
 *   <template #footer><UButton type="submit" form="login-form" label="Sign in" block /></template>
 * </AuthFrame>
 */
const { isCompact } = useLayoutContext()
</script>

<template>
  <div
    v-if="isCompact"
    class="flex min-h-dvh w-full flex-col bg-default"
  >
    <header class="border-b border-default p-4">
      <slot name="header" />
    </header>
    <div class="flex-1 p-4">
      <slot />
    </div>
    <footer class="space-y-2 border-t border-default px-4 pt-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
      <slot name="footer" />
    </footer>
  </div>
  <UCard
    v-else
    class="w-full max-w-sm"
    :ui="{ footer: 'space-y-2' }"
  >
    <template #header>
      <slot name="header" />
    </template>
    <slot />
    <template #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
