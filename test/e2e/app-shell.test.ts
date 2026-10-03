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
    await page.getByRole('link', { name: /Dashboard/ }).first().click()
    await expect.poll(() => page.title()).toBe('Dashboard · NUK Cafe Admin')
  })

  it('titles the error page', async () => {
    const page = await createPage()
    await mockApi(page)
    await page.goto(url('/c/nuk/admin/does-not-exist'))
    await expect.poll(() => page.title()).toBe('Page not found · NUK Cafe Admin')
  })
})
