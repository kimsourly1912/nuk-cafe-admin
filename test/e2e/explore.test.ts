import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContextOptions, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { setupE2e } from './support/mock-api'

// Close each WebGL context after the failure-capture hook has taken its evidence.
const pages: Page[] = []
afterEach(async () => {
  await Promise.all(pages.splice(0).map(page => page.context().close()))
})
await setupE2e()

async function createExplorePage(options?: BrowserContextOptions) {
  const page = await createPage(undefined, options)
  pages.push(page)
  return page
}

// Explore (D275, docs/plans/explore.md) on the built server: the demo café and its street,
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
    const page = await createExplorePage()
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
    const page = await createExplorePage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await open(page)
    await page.getByRole('button', { name: 'Jump' }).waitFor()
    await page.getByRole('button', { name: 'View menu' }).waitFor()
    await page.getByRole('button', { name: 'Open the map' }).first().waitFor()
    // No keyboard hint on a touch screen.
    await expect(page.getByText('to sprint').count()).resolves.toBe(0)
    await shot(page, 'phone-street')
  })

  it('calls the tuk-tuk from the map and cancels before pickup', { timeout: 120_000 }, async () => {
    const page = await createExplorePage()
    await open(page)
    await page.keyboard.press('m')
    const map = page.getByRole('dialog', { name: 'Map' })
    await map.getByRole('button', { name: 'Call tuk-tuk' }).click()
    await map.waitFor({ state: 'hidden' })
    await page.getByText('Tuk-tuk arriving', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Cancel ride' }).click()
    await page.getByText('Street', { exact: true }).waitFor()
    await expect(page.getByRole('button', { name: 'Talk to driver' }).count()).resolves.toBe(0)
  })

  it('boards from the curb, switches cameras, skips to the chosen stop and restores walking', { timeout: 240_000 }, async () => {
    const page = await createExplorePage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    await open(page)
    const action = (name: string) => page.getByRole('button', { name })
    await action('Call tuk-tuk').click()
    await action('Talk to driver').click()
    const picker = page.getByRole('dialog', { name: 'Where to?' })
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport)
      const bounds = await picker.getByRole('button', { name: 'Confirm destination' }).boundingBox()
      expect(bounds).toBeTruthy()
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await picker.getByRole('radio', { name: 'Shophouse row' }).check()
    await picker.getByRole('button', { name: 'Confirm destination' }).click()
    await picker.waitFor({ state: 'hidden' })

    // Back and right, around the rear of the tuk-tuk and onto the pickup curb.
    await page.keyboard.down('s')
    try {
      await holdUntil(page, 'd', () => action('Open passenger door').waitFor({ timeout: 35_000 }))
    }
    finally {
      await page.keyboard.up('s')
    }
    await action('Open passenger door').click()
    await action('Get in').click()
    await action('Outside view').waitFor()
    await shot(page, 'phone-ride-inside')
    await page.keyboard.press('e')
    await expect(action('Exit').count()).resolves.toBe(0)
    await action('Outside view').click()
    await action('Inside view').waitFor()
    await shot(page, 'phone-ride-outside')
    await action('Skip ride').click()
    await page.getByText('Arrived · Shophouse row', { exact: true }).waitFor()
    await action('Exit').click()
    await page.getByText('Waypoint: Demo café').waitFor()
    await expect(action('Exit').count()).resolves.toBe(0)
    await action('View menu').click()
    await page.waitForURL(address => address.pathname === `/c/${slug}`)
  })

  it('follows the dark mode the customer chose (D96), the map included', { timeout: 120_000 }, async () => {
    const page = await createExplorePage()
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
