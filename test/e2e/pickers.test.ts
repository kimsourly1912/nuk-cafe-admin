import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { failures, mockApi, setupE2e, TEA } from './support/mock-api'

// CategorySelect: the picker contract (docs/feature-standard.md → "Resource picker conventions").
await setupE2e()

const OOLONG_UNDER_MISSING = { id: 5, categoryName: 'Oolong', status: 'ACTIVE', type: 'SUB', mainCategoryId: 99, mainCategory: { id: 99, categoryName: 'Old parent' } }
const RETIRED = { id: 7, categoryName: 'Retired', status: 'INACTIVE', type: 'MAIN' }
const DORMANT = { id: 8, categoryName: 'Dormant', status: 'INACTIVE', type: 'MAIN' }
const GREEN_UNDER_RETIRED = { id: 6, categoryName: 'Green', status: 'ACTIVE', type: 'SUB', mainCategoryId: 7, mainCategory: { id: 7, categoryName: 'Retired' } }
const listOf = (...rows: object[]) => ({ content: rows, totalElements: rows.length, totalPages: 1, currentPage: 0, pageSize: 20, hasNext: false, hasPrevious: false })

async function editFirstRow(page: Page, handlers: Record<string, MockHandler>) {
  const api = await mockApi(page, handlers)
  await page.goto(url('/categories'), { waitUntil: 'hydration' })
  await page.getByRole('button', { name: 'Actions' }).first().click()
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
      'GET /staff/categories/all': () => {
        if (fail) throw failures.technical()
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
    const { form, parent } = await editFirstRow(page, {
      'GET /staff/categories': () => listOf(OOLONG_UNDER_MISSING),
      'GET /staff/categories/all': () => [TEA],
      'PUT /staff/categories/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return OOLONG_UNDER_MISSING
      },
    })
    await expect.poll(() => parent.textContent()).toContain('Old parent (unavailable)')

    await form.locator('input').first().fill('Oolong 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => body?.mainCategoryId).toBe(99)
  })

  it('shows an inactive current parent, but doesn\'t offer inactive categories as new choices (Q9)', async () => {
    const page = await createPage()
    const { parent } = await editFirstRow(page, {
      'GET /staff/categories': () => listOf(GREEN_UNDER_RETIRED),
      'GET /staff/categories/all': () => [TEA, RETIRED, DORMANT],
    })
    await expect.poll(() => parent.textContent()).toContain('Retired (inactive)')

    await parent.click()
    await page.getByRole('option', { name: 'Tea' }).waitFor()
    expect(await page.getByRole('option', { name: /Dormant/ }).count()).toBe(0)
    // The current value stays selectable (keeping it isn't a new selection).
    await page.getByRole('option', { name: 'Retired (inactive)' }).waitFor()
  })
})
