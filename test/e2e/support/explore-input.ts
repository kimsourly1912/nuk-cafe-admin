import type { Page } from 'playwright-core'

/** Release movement and use the prompt in one browser task, before another frame can move past it. */
export async function approachAndInteract(page: Page, keys: string[], label: string, timeout = 35_000) {
  await page.evaluate(({ keys, label, timeout }) => new Promise<void>((resolve, reject) => {
    function send(type: 'keydown' | 'keyup') {
      for (const code of keys) window.dispatchEvent(new KeyboardEvent(type, { code, cancelable: true }))
    }

    function stop() {
      observer.disconnect()
      clearTimeout(timer)
      send('keyup')
    }

    function interact() {
      const button = Array.from(document.querySelectorAll('button')).find(button =>
        button.textContent?.trim().startsWith(label) && button.getClientRects().length && !button.disabled,
      )
      if (!button) return
      stop()
      button.click()
      resolve()
    }

    const observer = new MutationObserver(interact)
    const timer = window.setTimeout(() => {
      stop()
      reject(new Error(`Explore did not offer "${label}" while holding ${keys.join(', ')}`))
    }, timeout)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    send('keydown')
    interact()
  }), { keys, label, timeout })
}
