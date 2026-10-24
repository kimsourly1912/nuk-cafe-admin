import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { mockApi, setupE2e } from './support/mock-api'
import { asNewVisitor } from './support/client-address'

// "Install app" in the admin's and the counter's user menus (D203): the steps for this device, the
// browser's own install dialog when it offered one, and nothing inside the installed app.
await setupE2e()

const seed = inject('shopSeed')
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

/** The device the page says it is (the steps follow `navigator`, not the layout). */
function device(page: Page, userAgent: string, touchPoints: number) {
  return page.addInitScript(([ua, touch]) => {
    Object.defineProperty(navigator, 'userAgent', { get: () => ua })
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => touch })
  }, [userAgent, touchPoints] as const)
}

/** Opened from its home-screen icon: `display-mode: standalone` matches. */
function installed(page: Page) {
  return page.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = query => query.includes('display-mode: standalone')
      ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList
      : real(query)
  })
}

async function admin(prepare?: (page: Page) => Promise<unknown>) {
  const page = await createPage()
  await prepare?.(page)
  await mockApi(page)
  await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'alice', exact: true }).click()
  return page
}

describe('install app from the admin\'s user menu', () => {
  it('shows the steps for an Android tablet', async () => {
    const page = await admin(page => device(page, ANDROID, 5))
    await page.getByRole('menuitem', { name: 'Install app' }).click()
    const dialog = page.getByRole('dialog', { name: 'Install NUK Cafe Admin' })
    await dialog.getByText('Tap ⋮ at the top right of Chrome').waitFor()
    await dialog.getByRole('button', { name: 'Got it' }).click()
    await dialog.waitFor({ state: 'hidden' })
  })

  it('shows Safari\'s steps on an iPad', async () => {
    const page = await admin(page => device(page, IPAD, 5))
    await page.getByRole('menuitem', { name: 'Install app' }).click()
    await page.getByRole('dialog').getByText('Tap the Share button in Safari').waitFor()
  })

  it('opens the browser\'s own install dialog when the browser offered one', async () => {
    const page = await admin()
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: () => {
          (window as { e2ePrompted?: number }).e2ePrompted = ((window as { e2ePrompted?: number }).e2ePrompted ?? 0) + 1
          return Promise.resolve({ outcome: 'accepted' })
        },
      })
      window.dispatchEvent(event)
    })
    await page.getByRole('button', { name: 'alice', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Install app' }).click()
    await expect.poll(() => page.evaluate(() => (window as { e2ePrompted?: number }).e2ePrompted)).toBe(1)
    expect(await page.getByRole('dialog').count()).toBe(0)
  })

  it('isn\'t offered inside the installed app', async () => {
    const page = await admin(installed)
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).waitFor()
    expect(await page.getByRole('menuitem', { name: 'Install app' }).count()).toBe(0)
  })
})

describe('install app from the counter\'s user menu', () => {
  it('names the cafe\'s counter app and shows the steps', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await device(page, ANDROID, 5)
    await page.goto(url('/c/nuk/counter'), { waitUntil: 'hydration' })
    await page.waitForURL(u => u.pathname === '/c/nuk/counter/sign-in')
    await page.getByLabel('Email').fill(seed.customers.cashier.email)
    await page.getByLabel('Password', { exact: true }).fill(seed.customers.cashier.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(u => u.pathname === `/c/nuk/counter/${seed.openBranchId}`)
    await page.getByRole('button', { name: /, account:/ }).click()
    await page.getByRole('menuitem', { name: 'Install app' }).click()
    await page.getByRole('dialog', { name: 'Install NUK Cafe Counter' }).getByText('Tap Install app (or Add to Home screen)').waitFor()
  })
})
