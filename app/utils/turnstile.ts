import type { HumanCheckAction } from '#shared/utils/human-check'

export interface TurnstileApi {
  render: (element: HTMLElement, options: {
    'sitekey': string
    'action': HumanCheckAction
    'theme': 'light' | 'dark'
    'size': 'flexible'
    'retry': 'never'
    'refresh-expired': 'never'
    'refresh-timeout': 'never'
    'callback': (token: string) => void
    'error-callback': () => boolean
    'expired-callback': () => void
    'timeout-callback': () => void
  }) => string
  remove: (id: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

// Only the public script's loading promise is shared; never tokens or form data.
let loading: Promise<TurnstileApi> | undefined

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    const failed = () => {
      clearTimeout(timer)
      script.remove()
      loading = undefined
      reject(new Error('Browser check could not load'))
    }
    const timer = setTimeout(failed, 15_000)
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (!window.turnstile) return failed()
      clearTimeout(timer)
      resolve(window.turnstile)
    }
    script.onerror = failed
    document.head.append(script)
  })
  return loading
}
