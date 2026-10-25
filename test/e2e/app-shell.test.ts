import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { gotoViaSidebar, mockApi, setupE2e } from './support/mock-api'

await setupE2e()

describe('app shell', () => {
  it('names each browser tab after its page', async () => {
    const page = await createPage()
    await mockApi(page)
    await gotoViaSidebar(page, [/Categories/])
    await expect.poll(() => page.title()).toBe('Categories · NUK Cafe Admin')
    await page.getByRole('link', { name: /Overview/ }).first().click()
    await expect.poll(() => page.title()).toBe('Overview · NUK Cafe Admin')
  })

  it('titles the error page', async () => {
    const page = await createPage()
    await mockApi(page)
    await page.goto(url('/c/nuk/admin/does-not-exist'))
    await expect.poll(() => page.title()).toBe('Page not found · NUK Cafe Admin')
  })
})

// components/SidebarResizeHandle.vue: a click on the sidebar's edge toggles it, a drag resizes it.
describe('sidebar edge', () => {
  async function openAdmin() {
    const page = await createPage()
    await mockApi(page)
    await page.goto(url('/c/nuk/admin'), { waitUntil: 'hydration' })
    return page
  }
  const sidebar = (page: Page) => page.locator('[data-collapsed]').first()
  const collapsed = (page: Page) => sidebar(page).getAttribute('data-collapsed')
  const width = async (page: Page) => (await sidebar(page).boundingBox())!.width
  /** Presses the handle and releases it after moving through `xs` (offsets from the press). */
  async function press(page: Page, ...xs: number[]) {
    const box = (await page.locator('[title$="drag to resize"]').boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + 100
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (const dx of xs) await page.mouse.move(x + dx, y, { steps: 5 })
    await page.mouse.up()
  }

  it('collapses and expands on click, even when the pointer jitters', async () => {
    const page = await openAdmin()
    await press(page, 2)
    await expect.poll(() => collapsed(page)).toBe('true')
    await expect.poll(() => width(page)).toBeLessThan(70) // the width animation has settled on the rail
    // On the collapsed rail any movement right used to expand it mid-press, so the release collapsed it again.
    await press(page, 3)
    await expect.poll(() => collapsed(page)).toBe('false')
  })

  it('stays in step with Ctrl+B', async () => {
    const page = await openAdmin()
    await page.keyboard.press('Control+b')
    await expect.poll(() => collapsed(page)).toBe('true')
    await expect.poll(() => width(page)).toBeLessThan(70)
    await press(page)
    await expect.poll(() => collapsed(page)).toBe('false')
    await page.keyboard.press('Control+b')
    await expect.poll(() => collapsed(page)).toBe('true')
  })

  it('resizes on drag without toggling, also when the drag ends where it began', async () => {
    const page = await openAdmin()
    const before = await width(page)
    await press(page, 40)
    await expect.poll(() => width(page)).toBeGreaterThan(before + 30)
    await press(page, 30, 0)
    await page.waitForTimeout(300)
    expect(await collapsed(page)).toBe('false')
  })
})
