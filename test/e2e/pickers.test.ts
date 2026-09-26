import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { categoryOf, failures, mockApi, setupE2e, TEA } from './support/mock-api'

// CategorySelect: the picker contract (docs/feature-standard.md → "Resource picker conventions").
await setupE2e()

const OOLONG_UNDER_MISSING = categoryOf('cat-5', 'Oolong', { parentId: 'cat-99' })
const RETIRED = categoryOf('cat-7', 'Retired', { status: 'INACTIVE' })
const DORMANT = categoryOf('cat-8', 'Dormant', { status: 'INACTIVE' })
const GREEN_UNDER_RETIRED = categoryOf('cat-6', 'Green', { parentId: 'cat-7' })
/**
 * The tree and the picker both call `GET /admin/categories`: the picker with `level=main`
 * (its options), the tree without (every category).
 */
const allCategories = (tree: object[], options: object[]): MockHandler => ({ url }) => (url.searchParams.get('level') ? options : tree)

async function editRow(page: Page, name: string, handlers: Record<string, MockHandler>) {
  const api = await mockApi(page, handlers)
  await page.goto(url('/categories'), { waitUntil: 'hydration' })
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit category' })
  await form.waitFor()
  return { api, form, parent: form.getByRole('combobox').first() }
}

describe('CategorySelect', () => {
  it('a failed options load shows the error with Retry, not an empty list', async () => {
    let fail = true
    const page = await createPage()
    await mockApi(page, {
      'GET /admin/categories': () => {
        if (fail) throw failures.server()
        return [TEA]
      },
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'New category' }).first().click()
    const form = page.getByRole('dialog', { name: 'New category' })
    await form.getByText('Could not load categories:').waitFor()

    fail = false
    // First click, with the empty autofocused name still focused: no blur validation may shift the button.
    await form.getByRole('button', { name: 'Retry' }).click()
    await form.getByText('Could not load categories:').waitFor({ state: 'hidden' })
    await form.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Tea' }).waitFor()
  })

  it('keeps a current parent that isn\'t among the options visible, and saving keeps it', async () => {
    const page = await createPage()
    let body: Record<string, unknown> | undefined
    const { form, parent } = await editRow(page, 'Oolong', {
      'GET /admin/categories': allCategories([OOLONG_UNDER_MISSING], [TEA]),
      'PATCH /admin/categories/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return OOLONG_UNDER_MISSING
      },
    })
    await expect.poll(() => parent.textContent()).toContain('Unknown category (unavailable)')

    await form.locator('input').first().fill('Oolong 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => body?.parentId).toBe('cat-99')
  })

  it('shows an inactive current parent, but doesn\'t offer inactive categories as new choices (Q9)', async () => {
    const page = await createPage()
    const { parent } = await editRow(page, 'Green', {
      'GET /admin/categories': allCategories([GREEN_UNDER_RETIRED], [TEA, RETIRED, DORMANT]),
    })
    await expect.poll(() => parent.textContent()).toContain('Retired (inactive)')

    await parent.click()
    await page.getByRole('option', { name: 'Tea' }).waitFor()
    expect(await page.getByRole('option', { name: /Dormant/ }).count()).toBe(0)
    // The current value stays selectable (keeping it isn't a new selection).
    await page.getByRole('option', { name: 'Retired (inactive)' }).waitFor()
  })
})
