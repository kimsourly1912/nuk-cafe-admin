/** Warn before closing/reloading the tab while mutations are still in flight. */
export default defineNuxtPlugin(() => {
  const pending = usePendingMutationCount()

  window.addEventListener('beforeunload', (event) => {
    if (pending.value > 0) {
      event.preventDefault()
      event.returnValue = '' // legacy browsers need this to show the prompt
    }
  })
})
