import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { MockFailure, TEA, mockApi, pageOf, setupE2e, toast } from './support/mock-api'

await setupE2e()

async function openCategories(handlers = {}) {
  const page = await createPage()
  const api = await mockApi(page, handlers)
  await page.goto(url('/categories'), { waitUntil: 'hydration' })
  await page.getByRole('cell', { name: 'Tea' }).waitFor()
  return { page, api }
}

describe('categories list', () => {
  it('shows the load error with Retry', async () => {
    let fail = true
    const page = await createPage()
    await mockApi(page, {
      'GET /staff/categories': () => {
        if (fail) throw new MockFailure('NC0000', 'No static resource staff/categories.', 200)
        return pageOf([TEA])
      },
    })
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByText('Could not load categories').waitFor()
    fail = false
    await page.getByRole('button', { name: 'Retry' }).click()
    await page.getByRole('cell', { name: 'Tea' }).waitFor()
  })

  it('deletes a category after confirmation', async () => {
    const { page, api } = await openCategories({ 'DELETE /staff/categories/{id}': () => null })
    await page.getByRole('button', { name: 'Actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByText('Delete "Tea"?').waitFor()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Category "Tea" deleted').waitFor()
    expect(api.calls).toContain('DELETE /staff/categories/1')
  })

  it('bulk-deletes selected rows with one confirmation and a summary', async () => {
    const { page, api } = await openCategories({
      'DELETE /staff/categories/{id}': ({ url }) => {
        if (url.pathname.endsWith('/2')) throw new MockFailure('NC0001', 'Category has menu items')
        return null
      },
    })
    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await page.getByText('2 selected').waitFor()
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, '1 category deleted, 1 failed').waitFor()
    expect(api.calls.filter(c => c.startsWith('DELETE'))).toHaveLength(2)
    // The failed row stays selected.
    await page.getByText('1 selected').waitFor()
  })
})
