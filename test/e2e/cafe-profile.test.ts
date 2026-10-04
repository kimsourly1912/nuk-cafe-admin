import { createPage, url } from '@nuxt/test-utils/e2e'
import type { Page } from 'playwright-core'
import { describe, expect, it } from 'vitest'
import type { CafeProfile, CafeSettings } from '../../shared/contracts/cafe'
import { failures, mockApi, NUK_PROFILE, setupE2e, toast } from './support/mock-api'

await setupE2e()

// Admin → Cafe profile (D143): the cafe's name and logo, shown in the sidebar, the tab title, the
// menu and the counter. The web address is read-only.

const SAVED: CafeSettings = { ...NUK_PROFILE, logoAssetId: null, version: 2 }
const PNG = { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') }

async function open(options: { width?: number, conflictOnce?: boolean } = {}) {
  let settings = SAVED
  let conflict = options.conflictOnce ?? false
  const saved: unknown[] = []
  const page = await createPage()
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 })
  await mockApi(page, {
    // The profile everyone reads follows the saved settings, as the server's does.
    'GET /cafes/nuk': (): CafeProfile => ({ slug: settings.slug, name: settings.name, logoUrl: settings.logoUrl, status: settings.status }),
    'GET /admin/cafe': () => settings,
    'PATCH /admin/cafe': ({ body }) => {
      saved.push(body)
      if (conflict) {
        conflict = false
        settings = { ...settings, version: settings.version + 1, name: 'Someone else\'s name' }
        throw failures.conflict('VERSION_CONFLICT', 'The cafe was changed by someone else. Reload it and try again.')
      }
      const input = body as { version: number, name: string, logoAssetId: string | null }
      settings = { ...settings, name: input.name, logoAssetId: input.logoAssetId, logoUrl: input.logoAssetId ? `/media/${input.logoAssetId}.webp` : null, version: input.version + 1 }
      return settings
    },
    'POST /admin/media': () => ({ id: 'asset-9', url: '/media/asset-9.webp' }),
  })
  await page.goto(url('/c/nuk/admin/cafe'), { waitUntil: 'hydration' })
  await page.getByRole('heading', { name: 'Name and logo' }).waitFor()
  return { page, saved }
}

const sidebarName = (page: Page) => page.getByRole('button', { name: /Admin: cafe menu$/ })

describe('Cafe profile', () => {
  it('saves a new name and logo; the sidebar and the tab title follow', async () => {
    const { page, saved } = await open()
    expect(await sidebarName(page).textContent()).toContain('NUK Cafe Admin')
    await expect.poll(() => page.title()).toBe('Cafe profile · NUK Cafe Admin')
    // The address is the platform team's: shown, not editable.
    await page.getByRole('link', { name: /\/c\/nuk$/ }).waitFor()
    expect(await page.getByRole('button', { name: 'Save changes' }).first().isDisabled()).toBe(true)

    await page.getByLabel('Cafe name').fill('Nuk Coffee House')
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Upload logo' }).click()])
    await chooser.setFiles(PNG)
    await page.getByRole('button', { name: 'Replace logo' }).waitFor()
    await page.getByText('Nuk Coffee House', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Save changes' }).first().click()
    await toast(page, 'Cafe profile saved').waitFor()
    expect(saved).toEqual([{ version: 2, name: 'Nuk Coffee House', logoAssetId: 'asset-9' }])
    await expect.poll(() => sidebarName(page).textContent()).toContain('Nuk Coffee House Admin')
    await expect.poll(() => page.title()).toBe('Cafe profile · Nuk Coffee House Admin')
    expect(await sidebarName(page).locator('img').getAttribute('src')).toBe('/media/asset-9.webp')
  })

  it('needs a name', async () => {
    const { page, saved } = await open()
    await page.getByLabel('Cafe name').fill('')
    await page.getByLabel('Cafe name').blur()
    await page.getByRole('button', { name: 'Save changes' }).first().click()
    await page.getByText('Cafe name is required').waitFor({ timeout: 5000 })
    expect(saved).toEqual([])
  })

  it('someone else\'s save meanwhile: Reload keeps the input, then saves at the new version', async () => {
    const { page, saved } = await open({ conflictOnce: true })
    await page.getByLabel('Cafe name').fill('Nuk Coffee House')
    await page.getByRole('button', { name: 'Save changes' }).first().click()
    await page.getByText('Someone else changed the cafe profile').waitFor()
    await page.getByRole('button', { name: 'Reload' }).click()
    await page.getByText('Someone else changed the cafe profile').waitFor({ state: 'detached' })
    expect(await page.getByLabel('Cafe name').inputValue()).toBe('Nuk Coffee House')
    await page.getByRole('button', { name: 'Save changes' }).first().click()
    await toast(page, 'Cafe profile saved').waitFor()
    expect(saved).toEqual([
      { version: 2, name: 'Nuk Coffee House', logoAssetId: null },
      { version: 3, name: 'Nuk Coffee House', logoAssetId: null },
    ])
  })

  it('on a phone, Save is in the bottom bar while there are changes', async () => {
    const { page, saved } = await open({ width: 390 })
    const bar = page.getByRole('toolbar', { name: 'Save' })
    expect(await bar.isVisible()).toBe(false)
    await page.getByLabel('Cafe name').fill('Nuk Coffee House')
    await page.getByLabel('Cafe name').blur()
    await bar.getByRole('button', { name: 'Save changes' }).click()
    await toast(page, 'Cafe profile saved').waitFor()
    expect(saved).toHaveLength(1)
  })

  it('is in the sidebar\'s Admin group', async () => {
    const { page } = await open()
    await page.getByRole('link', { name: 'Cafe profile' }).waitFor()
  })
})
