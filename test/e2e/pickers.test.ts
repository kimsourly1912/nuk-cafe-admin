import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { failures, MENU_TEA, menuCategoryOf, mockApi, setupE2e } from './support/mock-api'

// CategorySelect: the picker contract (docs/feature-standard.md → "Resource picker conventions").
// The tree and the pickers share one query (`categories:all`): one handler answers both.
await setupE2e()

const OOLONG_UNDER_MISSING = menuCategoryOf('cat-5', 'Oolong', { parentId: 'cat-99' })
const RETIRED = menuCategoryOf('cat-7', 'Retired', { status: 'archived' })
const DORMANT = menuCategoryOf('cat-8', 'Dormant', { status: 'archived' })
const GREEN_UNDER_RETIRED = menuCategoryOf('cat-6', 'Green', { parentId: 'cat-7' })

async function editRow(page: Page, name: string, handlers: Record<string, MockHandler>) {
  const api = await mockApi(page, handlers)
  await page.goto(url('/c/nuk/admin/categories'), { waitUntil: 'hydration' })
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const form = page.getByRole('dialog', { name: 'Edit category' })
  await form.waitFor()
  return { api, form, parent: form.getByRole('button', { name: 'Parent category', exact: true }) }
}

describe('CategorySelect', () => {
  it('a failed options load shows the error with Retry, not an empty list', async () => {
    let fail = true
    const page = await createPage()
    await mockApi(page, {
      'GET /admin/menu/categories': () => {
        if (fail) throw failures.server()
        return [MENU_TEA]
      },
    })
    await page.goto(url('/c/nuk/admin/categories'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'New category' }).first().click()
    const form = page.getByRole('dialog', { name: 'New category' })
    await form.getByText('Could not load categories:').waitFor()

    fail = false
    // First click, with the empty autofocused name still focused: no blur validation may shift the button.
    await form.getByRole('button', { name: 'Retry' }).click()
    await form.getByText('Could not load categories:').waitFor({ state: 'hidden' })
    await form.getByRole('button', { name: 'Parent category', exact: true }).click()
    await page.getByRole('option', { name: 'Tea' }).waitFor()
  })

  it('keeps a current parent that isn\'t among the options visible, and saving keeps it', async () => {
    const page = await createPage()
    let body: Record<string, unknown> | undefined
    const { form, parent } = await editRow(page, 'Oolong', {
      'GET /admin/menu/categories': () => [MENU_TEA, OOLONG_UNDER_MISSING],
      'PATCH /admin/menu/categories/{id}': (request) => {
        body = request.body as Record<string, unknown>
        return OOLONG_UNDER_MISSING
      },
    })
    await expect.poll(() => parent.textContent()).toContain('Unknown category (unavailable)')

    await form.getByLabel('Name').fill('Oolong 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => body?.parentId).toBe('cat-99')
  })

  it('shows an archived current parent, but doesn\'t offer archived categories as new choices', async () => {
    const page = await createPage()
    const { parent } = await editRow(page, 'Green', {
      'GET /admin/menu/categories': () => [MENU_TEA, RETIRED, DORMANT, GREEN_UNDER_RETIRED],
    })
    await expect.poll(() => parent.textContent()).toContain('Retired (archived)')

    await parent.click()
    await page.getByRole('option', { name: 'Tea' }).waitFor()
    expect(await page.getByRole('option', { name: /Dormant/ }).count()).toBe(0)
    // The current value stays selectable (keeping it isn't a new selection).
    await page.getByRole('option', { name: 'Retired (archived)' }).waitFor()
  })
})
