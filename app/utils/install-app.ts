/**
 * Installing the counter or the admin as an app (D202, D203): which steps to show. A browser that
 * can install by itself (Chrome's `beforeinstallprompt`) gets its own dialog instead; everyone else
 * gets the steps for their device. Text only: nothing here changes a layout by device.
 */
export type InstallPlatform = 'ios' | 'android' | 'desktop'

/** iPadOS reports itself as a Mac; a Mac with touch is an iPad. */
export function installPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(userAgent)) return 'android'
  return 'desktop'
}

export const INSTALL_STEPS: Record<InstallPlatform, readonly string[]> = {
  android: ['Tap ⋮ at the top right of Chrome', 'Tap Install app (or Add to Home screen)', 'Open it from its icon on the home screen'],
  ios: ['Tap the Share button in Safari', 'Tap Add to Home Screen, then Add', 'Open it from its icon on the home screen'],
  desktop: ['Click the install icon at the right end of the address bar, or open the browser menu', 'Choose Install', 'Open it from its own window or the app list'],
}
