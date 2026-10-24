import { useMediaQuery } from '@vueuse/core'
import { InstallAppModal } from '#components'

/** Chrome and Edge's install event (not in TypeScript's DOM types: it isn't a web standard). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** The browser's install event, kept by `plugins/install-prompt.client.ts` until it's used. */
const installPrompt = shallowRef<InstallPromptEvent | null>(null)

export function keepInstallPrompt(event: Event | null) {
  installPrompt.value = event as InstallPromptEvent | null
}

/**
 * "Install app" in the counter's and the admin's user menus (D203): hidden once running as the
 * installed app; the browser's own install dialog when it offered one (Chrome without a service
 * worker usually doesn't, D202), else a modal with the steps for this device.
 */
export function useInstallApp() {
  const standalone = useMediaQuery('(display-mode: standalone)')
  // Safari's own flag for a site opened from the home screen.
  const installed = computed(() => standalone.value || (import.meta.client && (navigator as Navigator & { standalone?: boolean }).standalone === true))
  const modal = useOverlay().create(InstallAppModal)

  async function install(appName: string) {
    const prompt = installPrompt.value
    if (prompt) {
      // An event can prompt once; the browser sends a new one if it's still installable.
      installPrompt.value = null
      await prompt.prompt()
      return
    }
    modal.open({ appName, platform: installPlatform(navigator.userAgent, navigator.maxTouchPoints) })
  }

  return { installed, install }
}
