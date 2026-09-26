import { useEventListener } from '@vueuse/core'

/**
 * Warn before closing/reloading the tab while mutations are still in flight or a form has
 * unsaved changes. Browsers show their own "Leave site?" dialog; its text can't be customized.
 * The listener is attached only while needed: a permanent `beforeunload` listener disables
 * the browser's back/forward cache.
 */
export default defineNuxtPlugin(() => {
  const pending = usePendingMutationCount()
  const { hasUnsavedChanges } = useLeaveGuard()

  const target = computed(() => (pending.value > 0 || hasUnsavedChanges.value) ? window : undefined)
  useEventListener(target, 'beforeunload', (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = '' // legacy browsers need this to show the prompt
  })
})
