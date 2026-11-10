import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { mockApi, setupE2e } from './support/mock-api'

await setupE2e()

// The shop designer's step 1 prototype (D273): demo data on the client, nothing saved. The review
// checkpoint: place a table, move one upstairs, open the 3D view and find it on the right floor.
// `SHOP_DESIGNER_SCREENSHOTS=1` keeps screenshots in output/playwright/shop-designer for review.

const PATH = '/c/nuk/admin/prototypes/shop-designer'
const output = join(process.cwd(), 'output', 'playwright', 'shop-designer')

async function open(width = 1440, height = 900) {
  const page = await createPage()
  await page.setViewportSize({ width, height })
  await mockApi(page)
  await page.goto(url(PATH), { waitUntil: 'hydration' })
  await page.getByTestId('floor-plan').waitFor()
  return page
}

async function shot(page: Page, name: string) {
  if (!process.env.SHOP_DESIGNER_SCREENSHOTS) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, `${name}.png`) })
}

const plan = (page: Page) => page.getByTestId('floor-plan')
/** The 3D view's first frame is on screen. */
const drawn = (page: Page) => page.locator('[data-testid="building-canvas"][data-drawn="true"]').waitFor({ timeout: 40_000 })
const unplaced = (page: Page, label: string) => page.getByTestId(`unplaced-${label}`)

describe('shop designer prototype', () => {
  it('places an unplaced table with Place on map, moves it with the pad, and undoes', async () => {
    const page = await open()
    await expect.poll(() => page.title()).toContain('Shop designer')
    await shot(page, 'design-shop')
    await expect.poll(() => unplaced(page, 'T11').count()).toBe(1)

    await unplaced(page, 'T11').getByRole('button', { name: 'Place on map' }).click()
    await expect.poll(() => plan(page).getByTestId('plan-table-T11').count()).toBe(1)
    await expect.poll(() => unplaced(page, 'T11').count()).toBe(0)
    // Selected: its panel and the move pad show.
    await page.getByRole('complementary', { name: 'Selected table' }).getByText('T11', { exact: true }).waitFor()
    const before = await plan(page).getByTestId('plan-table-T11').getAttribute('transform')
    await page.getByRole('button', { name: 'Move right 25 cm' }).click()
    await expect.poll(() => plan(page).getByTestId('plan-table-T11').getAttribute('transform')).not.toBe(before)
    await shot(page, 'placed-T11')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => plan(page).getByTestId('plan-table-T11').getAttribute('transform')).toBe(before)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => plan(page).getByTestId('plan-table-T11').count()).toBe(0)
    await expect.poll(() => unplaced(page, 'T11').count()).toBe(1)
  })

  it('places a table by dragging it from the library onto the plan, snapped to the grid', async () => {
    const page = await open()
    const grip = unplaced(page, 'T12').locator('span[aria-hidden="true"]').first()
    const from = (await grip.boundingBox())!
    const area = (await plan(page).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(area.x + area.width * 0.45, area.y + area.height * 0.7, { steps: 8 })
    await expect.poll(() => page.getByTestId('plan-ghost').count()).toBe(1)
    await shot(page, 'ghost-T12')
    await page.mouse.up()
    await expect.poll(() => plan(page).getByTestId('plan-table-T12').count()).toBe(1)
    const transform = await plan(page).getByTestId('plan-table-T12').getAttribute('transform')
    const [, x, y] = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform ?? '') ?? []
    expect(Number(x) % 25).toBe(0)
    expect(Number(y) % 25).toBe(0)
  })

  it('moves T03 upstairs and finds it on the First floor in 3D', { timeout: 60_000 }, async () => {
    const page = await open()
    await plan(page).getByTestId('plan-table-T03').click()
    const panel = page.getByRole('complementary', { name: 'Selected table' })
    await panel.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'First' }).click()
    // The editor follows the table to its new floor.
    await expect.poll(() => page.getByRole('button', { name: /^First/, pressed: true }).count()).toBe(1)
    await expect.poll(() => plan(page).getByTestId('plan-table-T03').count()).toBe(1)

    await page.getByRole('tab', { name: 'View in 3D' }).click()
    await page.getByTestId('building-canvas').waitFor()
    // The building is drawn. Not the quality line: that waits for the device to be measured, slow
    // in CI's software renderer (seconds a frame on 2 shared cores).
    await drawn(page)
    const lists = page.getByRole('complementary', { name: 'Navigate the building' })
    await lists.getByTestId('list-table-T03').click()
    const card = page.getByTestId('table-card')
    await expect.poll(() => card.textContent()).toContain('First floor')
    await shot(page, '3d-exterior-T03')

    await page.getByRole('button', { name: 'Cutaway' }).click()
    await page.waitForTimeout(800)
    await shot(page, '3d-cutaway')
    await lists.getByRole('button', { name: 'First floor' }).click()
    await lists.getByRole('button', { name: 'Enter floor' }).click()
    await page.getByRole('button', { name: 'Back to building' }).waitFor()
    await page.waitForTimeout(900)
    await shot(page, '3d-inside-first')
    // Inside a floor, its viewpoints come from its layout: no front door upstairs.
    expect(await page.getByRole('button', { name: 'Entrance' }).count()).toBe(0)
    await page.getByRole('button', { name: 'Top of stairs' }).waitFor()

    await card.getByRole('button', { name: 'Show on plan' }).click()
    await expect.poll(() => page.getByRole('complementary', { name: 'Selected table' }).textContent()).toContain('T03')
  })

  it('shows a preset in the furniture studio and changes its finish', async () => {
    const page = await open()
    await page.getByRole('tab', { name: 'Furniture studio' }).click()
    await page.getByTestId('studio-canvas').waitFor()
    await page.getByRole('tab', { name: 'Chairs' }).click()
    await page.getByRole('heading', { name: 'Café chair' }).waitFor()
    await page.getByRole('button', { name: 'Walnut' }).first().click()
    await expect.poll(() => page.getByRole('button', { name: 'Walnut', pressed: true }).count()).toBe(1)
    await page.waitForTimeout(600)
    await shot(page, 'studio-chair')
    await page.getByRole('tab', { name: 'Tables' }).click()
    await page.getByRole('button', { name: 'Round café table' }).click()
    await page.waitForTimeout(600)
    await shot(page, 'studio-table')
  })

  it('works on a phone: the 3D view with its lists in a drawer', { timeout: 60_000 }, async () => {
    const page = await open(390, 844)
    await page.getByRole('tab', { name: 'View in 3D' }).click()
    await drawn(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Floors and tables' }).click()
    await page.getByRole('dialog').getByTestId('list-table-T09').click()
    await expect.poll(() => page.getByTestId('table-card').textContent()).toContain('Rooftop floor')
    await shot(page, 'phone-3d')
  })

  it('draws the 3D view in dark mode', { timeout: 60_000 }, async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockApi(page)
    await page.goto(url(PATH), { waitUntil: 'hydration' })
    await page.evaluate(() => localStorage.setItem('nuxt-color-mode', 'dark'))
    await page.goto(url(`${PATH}?tab=3d`), { waitUntil: 'hydration' })
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await drawn(page)
    await page.getByRole('button', { name: 'Cutaway' }).click()
    await page.getByRole('complementary', { name: 'Navigate the building' }).getByTestId('list-table-T06').click()
    await page.waitForTimeout(800)
    await shot(page, '3d-cutaway-dark')
  })
})
