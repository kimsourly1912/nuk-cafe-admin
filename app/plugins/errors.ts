/**
 * Safety net for errors nobody caught (e.g. an event handler without try/catch).
 * Handled errors never reach this. Prefer explicit `useNotify().error(...)` at the call site.
 */
export default defineNuxtPlugin({
  name: 'errors',
  dependsOn: ['api'],
  setup(nuxtApp) {
    const notify = useNotify()

    nuxtApp.hook('vue:error', (error) => {
      notify.error('Unexpected error', error)
    })

    if (import.meta.client) {
      window.addEventListener('unhandledrejection', (event) => {
        if (event.reason instanceof ApiError) notify.error('Unexpected error', event.reason)
      })
    }
  },
})
