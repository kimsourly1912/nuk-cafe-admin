import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { menuCategoryOf, mockApi, setupE2e } from './support/mock-api'

// The UI foundations of D77/D78: compact touch targets configured once in app.config.ts, the
// light-mode primary shade, and the shared bottom action bar. Checked on the Categories page.
await setupE2e()

const DRINKS = menuCategoryOf('cat-1', 'Drinks', { sortOrder: 1, childCount: 1 })
const COFFEE = menuCategoryOf('cat-11', 'Coffee', { sortOrder: 1, parentId: 'cat-1' })
/** Enough categories that the list scrolls on a phone. */
const MANY = Array.from({ length: 14 }, (_, i) => menuCategoryOf(`cat-${i + 20}`, `Category ${i + 1}`, { sortOrder: i + 2 }))

const handlers: Record<string, MockHandler> = {
  'GET /admin/menu/categories': () => [DRINKS, COFFEE, ...MANY],
  'GET /admin/menu/availability-rules': () => [],
}

async function open(width: number, height = 812, colorScheme: 'light' | 'dark' = 'light') {
  const page = await createPage()
  await page.emulateMedia({ colorScheme })
  await page.setViewportSize({ width, height })
  await mockApi(page, handlers)
  await page.goto(url('/categories'), { waitUntil: 'hydration' })
  await page.getByRole('listitem', { name: 'Coffee', exact: true }).waitFor()
  return page
}

/**
 * Every visible Nuxt UI control (its `data-slot` root: buttons, fields, tabs) that's smaller than 44px:
 * `[what, width, height]`. The central configuration covers Nuxt UI's components only; plain
 * elements a page draws itself are its own step of the migration (docs/plans/ui-standardization.md).
 */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>('[data-slot="base"]:is(button, input, a):not([role=checkbox]):not([role=switch]):not([role=radio]), [data-slot="trigger"][role=tab]')
    return [...controls]
      .filter(el => el.offsetParent !== null && !el.closest('[aria-hidden="true"]'))
      .map((el) => {
        const box = el.getBoundingClientRect()
        const iconOnly = el.tagName === 'BUTTON' && !el.textContent?.trim()
        const tooSmall = box.height < 44 || (iconOnly && box.width < 44)
        return tooSmall ? [el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName, Math.round(box.width), Math.round(box.height)] : null
      })
      .filter(Boolean)
  })
}

/** A CSS color as sRGB 0–255, as the browser paints it (Tailwind's colors are oklch). */
function painted(page: Page, color: string, over = 'white') {
  return page.evaluate(([color, over]) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = over
    context.fillRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }, [color, over] as const)
}

function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const cssVar = (page: Page, name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

describe('touch targets', () => {
  it('gives every button, tab and field at least 44px on a phone (icon-only buttons 44×44)', async () => {
    const page = await open(375)
    expect(await smallTargets(page)).toEqual([])
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Select Drinks' }).waitFor()
    expect(await smallTargets(page)).toEqual([])
  })

  it('keeps Nuxt UI\'s own sizes from sm up', async () => {
    const page = await open(1024)
    const box = (await page.getByRole('button', { name: 'Select', exact: true }).boundingBox())!
    expect(box.height).toBeLessThan(40)
  })

  it('gives a checkbox a 44px hit area on a phone without making it bigger', async () => {
    const page = await open(375)
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    const checkbox = page.getByRole('checkbox', { name: 'Select Coffee' })
    const box = (await checkbox.boundingBox())!
    expect(Math.round(box.width)).toBe(16)
    // 12px outside the visible box still hits it
    await page.mouse.click(box.x + box.width / 2, box.y + box.height + 12)
    await expect.poll(() => checkbox.getAttribute('aria-checked')).toBe('true')
  })
})

describe('primary color', () => {
  it('uses the 800 shade in light mode: AA contrast as text, on its own tint and behind white text', async () => {
    const page = await open(1024)
    expect(await cssVar(page, '--ui-primary')).toBe(await cssVar(page, '--ui-color-primary-800'))
    const primary = await painted(page, await cssVar(page, '--ui-primary'))
    const white = [255, 255, 255]
    expect(contrast(primary, white)).toBeGreaterThanOrEqual(4.5)
    // Primary text on its own tint (`text-primary` on `bg-primary/10`)
    const tint = await painted(page, `color-mix(in oklab, ${await cssVar(page, '--ui-primary')} 10%, transparent)`)
    expect(contrast(primary, tint)).toBeGreaterThanOrEqual(4.5)
    // A solid primary button's own label on its own background
    const add = page.getByRole('button', { name: 'New category' }).first()
    const [label, background] = await add.evaluate((el) => {
      const style = getComputedStyle(el)
      return [style.color, style.backgroundColor]
    })
    expect(contrast(await painted(page, label!), await painted(page, background!))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps Nuxt UI\'s 400 shade in dark mode', async () => {
    const page = await open(1024, 812, 'dark')
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    expect(await cssVar(page, '--ui-primary')).toBe(await cssVar(page, '--ui-color-primary-400'))
    const add = page.getByRole('button', { name: 'New category' }).first()
    const [label, background, body] = await add.evaluate((el) => {
      const style = getComputedStyle(el)
      return [style.color, style.backgroundColor, getComputedStyle(document.body).backgroundColor]
    })
    const primary = await painted(page, await cssVar(page, '--ui-primary'), body!)
    expect(contrast(primary, await painted(page, body!))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(await painted(page, label!), await painted(page, background!))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('warning color', () => {
  it('uses the 800 shade in light mode: AA contrast as text and on its own tint', async () => {
    const page = await open(1024)
    expect(await cssVar(page, '--ui-warning')).toBe(await cssVar(page, '--ui-color-warning-800'))
    const warning = await painted(page, await cssVar(page, '--ui-warning'))
    const white = [255, 255, 255]
    expect(contrast(warning, white)).toBeGreaterThanOrEqual(4.5)
    // `text-warning` on `bg-warning/10` (subtle badges)
    const tint = await painted(page, `color-mix(in oklab, ${await cssVar(page, '--ui-warning')} 10%, transparent)`)
    expect(contrast(warning, tint)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps Nuxt UI\'s 400 shade in dark mode, readable on the dark background', async () => {
    const page = await open(1024, 812, 'dark')
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    expect(await cssVar(page, '--ui-warning')).toBe(await cssVar(page, '--ui-color-warning-400'))
    const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const warning = await painted(page, await cssVar(page, '--ui-warning'), body)
    expect(contrast(warning, await painted(page, body))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('bottom action bar', () => {
  it('pins to the bottom of a phone and makes room: the last row scrolls clear of it', async () => {
    const page = await open(375, 667)
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Select Drinks' }).click()
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await bar.getByText('1 selected').waitFor()
    const barBox = (await bar.boundingBox())!
    expect(Math.round(barBox.y + barBox.height)).toBe(667)

    const last = page.getByRole('listitem', { name: 'Category 14', exact: true })
    await last.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const body = document.querySelector('[role="toolbar"][aria-label="Bulk actions"]')!.closest('[data-slot="body"]') ?? document.scrollingElement!
      body.scrollTop = body.scrollHeight
    })
    await expect.poll(async () => {
      const box = (await last.boundingBox())!
      return box.y + box.height <= barBox.y
    }).toBe(true)
  })

  it('sits above the tree from lg, in the page flow', async () => {
    const page = await open(1280)
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    const bar = page.getByRole('toolbar', { name: 'Bulk actions' })
    await bar.waitFor()
    expect(await bar.evaluate(el => getComputedStyle(el).position)).toBe('static')
    const tree = (await page.getByRole('list', { name: 'Categories', exact: true }).boundingBox())!
    expect((await bar.boundingBox())!.y).toBeLessThan(tree.y)
  })
})
