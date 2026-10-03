import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { mockApi, setupE2e, SIGNED_OUT } from './support/mock-api'

await setupE2e()

// Light and dark (D96): light by default whatever the system prefers; the color-mode button
// switches, and the choice is kept in this browser for the store and the admin alike.

const isDark = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('dark'))

describe('color mode', () => {
  it('is light on a dark system, switches from the store\'s header, and keeps the choice on reload and in the admin', async () => {
    const page = await createPage()
    await page.emulateMedia({ colorScheme: 'dark' })
    const problems: string[] = []
    page.on('console', message => message.type() === 'error' && problems.push(message.text()))
    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { name: 'Coffee', exact: true }).waitFor()
    expect(await isDark(page)).toBe(false)

    await page.locator('header').getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect.poll(() => isDark(page)).toBe(true)

    await page.goto(url('/c/nuk'), { waitUntil: 'hydration' })
    expect(await isDark(page)).toBe(true)
    expect(problems).toEqual([])

    await mockApi(page, SIGNED_OUT)
    await page.goto(url('/c/nuk/admin/login'), { waitUntil: 'hydration' })
    expect(await isDark(page)).toBe(true)
    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect.poll(() => isDark(page)).toBe(false)
  })

  it('is light on the admin\'s first visit too', async () => {
    const page = await createPage()
    await page.emulateMedia({ colorScheme: 'dark' })
    await mockApi(page, SIGNED_OUT)
    await page.goto(url('/c/nuk/admin/login'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Sign in' }).waitFor()
    expect(await isDark(page)).toBe(false)
  })
})
