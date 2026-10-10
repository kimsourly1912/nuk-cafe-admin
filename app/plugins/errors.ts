/**
 * Safety net for errors nobody caught (e.g. an event handler without try/catch).
 * Handled errors never reach this. Prefer explicit `useNotify().error(...)` at the call site.
 *
 * In the browser, each one is also reported to the server (D149, `POST /api/client-errors`, into
 * Workers Logs), so an error on a customer's phone or a counter tablet doesn't go unseen. Our API's
 * own failures aren't: the server logged them already.
 */
export default defineNuxtPlugin({
  name: 'errors',
  setup(nuxtApp) {
    const notify = useNotify()
    const reporter = import.meta.client
      ? createClientErrorReporter({
          send: report => void $fetch('/api/client-errors', { method: 'POST', body: report, keepalive: true }).catch(() => {}),
          page: () => window.location.pathname,
          build: useRuntimeConfig().app.buildId,
        })
      : null

    nuxtApp.hook('vue:error', (error) => {
      notify.error('Unexpected error', error)
      reporter?.report('vue', error)
    })

    if (import.meta.client) {
      window.addEventListener('unhandledrejection', (event) => {
        if (event.reason instanceof ApiError) notify.error('Unexpected error', event.reason)
        reporter?.report('rejection', event.reason)
      })
      // A script error outside Vue (a timer, a listener). An image that fails to load also fires
      // `error`, but not as an `ErrorEvent` with an error; another site's script only says "Script error.".
      window.addEventListener('error', (event) => {
        if (event instanceof ErrorEvent && event.error) reporter?.report('error', event.error)
      })
    }
  },
})
