import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import { setupE2e } from './support/mock-api'

await setupE2e()

// Explore, step E1 (D275, docs/plans/explore.md) on the built server: the demo café and its street,
// played by keyboard as a customer would. Software WebGL draws slowly in CI and the simulation
// runs at most five steps a frame, so the waits are long; nothing here measures speed (the owner's
// phone does, `?bench=walk`). `EXPLORE_SCREENSHOTS=1` keeps screenshots in output/playwright/explore.

const seed = inject('shopSeed')
const slug = seed.secondCafe.slug
const output = join(process.cwd(), 'output', 'playwright', 'explore')

async function shot(page: Page, name: string) {
  if (!process.env.EXPLORE_SCREENSHOTS) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, `${name}.png`) })
}

async function open(page: Page) {
  page.setDefaultTimeout(60_000)
  await page.goto(url(`/c/${slug}/explore`))
  // The world is up once the status shows where the player stands.
  await page.getByText('Street', { exact: true }).waitFor()
}

/** Holds a key until `done` shows, then lets go. */
async function holdUntil(page: Page, key: string, done: () => Promise<void>) {
  await page.keyboard.down(key)
  try {
    await done()
  }
  finally {
    await page.keyboard.up(key)
  }
}

describe('Explore', () => {
  it('walks from the street through the café\'s door with a waypoint, and opens the menu', { timeout: 240_000 }, async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page)
    await expect(page.title()).resolves.toContain('Explore')
    await shot(page, 'desktop-street')

    // M opens the map; it pauses the world. Escape closes it and stays on the page.
    await page.keyboard.press('m')
    const map = page.getByRole('dialog', { name: 'Map' })
    await map.waitFor()
    // After the modal's fade-in, so the screenshot shows the map, not the transition.
    await page.waitForTimeout(400)
    await shot(page, 'desktop-map')
    await page.keyboard.press('Escape')
    await map.waitFor({ state: 'hidden' })
    expect(new URL(page.url()).pathname).toBe(`/c/${slug}/explore`)

    // A waypoint on the café, from the minimap's map.
    await page.getByRole('button', { name: 'Open the map' }).first().click()
    await map.getByRole('button', { name: 'Set waypoint' }).click()
    await map.waitFor({ state: 'hidden' })
    await page.getByText('Waypoint: Demo café').waitFor()

    // Walk to the door: the context button offers to open it.
    const action = (label: string) => page.getByRole('button', { name: label })
    await holdUntil(page, 'w', () => action('Open door').waitFor({ timeout: 120_000 }))
    await shot(page, 'desktop-door')
    await page.keyboard.press('e')
    await action('Close door').waitFor()

    // Through it: the status says where, and the waypoint is reached.
    await holdUntil(page, 'w', () => page.getByText('Demo café · Ground').waitFor({ timeout: 120_000 }))
    await page.getByText('Waypoint: Demo café').waitFor({ state: 'hidden' })
    await shot(page, 'desktop-inside')

    await page.getByRole('button', { name: 'View menu' }).click()
    await page.waitForURL(address => address.pathname === `/c/${slug}`)
  })

  it('on a phone, shows the touch controls and every way back to the menu', { timeout: 120_000 }, async () => {
    const page = await createPage(undefined, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await open(page)
    await page.getByRole('button', { name: 'Jump' }).waitFor()
    await page.getByRole('button', { name: 'View menu' }).waitFor()
    await page.getByRole('button', { name: 'Open the map' }).first().waitFor()
    // No keyboard hint on a touch screen.
    await expect(page.getByText('to sprint').count()).resolves.toBe(0)
    await shot(page, 'phone-street')
  })

  it('follows the dark mode the customer chose (D96), the map included', { timeout: 120_000 }, async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'))
    await open(page)
    await expect(page.evaluate(() => document.documentElement.classList.contains('dark'))).resolves.toBe(true)
    await page.keyboard.press('m')
    await page.getByRole('dialog', { name: 'Map' }).waitFor()
    await page.waitForTimeout(400)
    await shot(page, 'dark-map')
  })
})
