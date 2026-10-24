import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { BranchSettings, DiningTable } from '../../shared/contracts/branches'
import type { MockHandler } from './support/mock-api'
import { AIRPORT, failures, gotoViaSidebar, MockFailure, mockApi, RIVERSIDE, setupE2e, toast, toastAction } from './support/mock-api'

await setupE2e()

// The Branch page (step 5.1b, D91): settings and hours as one draft, dining tables with QR codes.

const STAMP = '2026-09-29T00:00:00.000Z'
const w = (weekday: number, startMinute: number, endMinute: number) => ({ weekday, startMinute, endMinute })
const SETTINGS: BranchSettings = {
  id: RIVERSIDE.id,
  name: 'Riverside',
  timezone: 'Asia/Phnom_Penh',
  address: '#123 St. 63',
  phone: null,
  status: 'active',
  hours: [1, 2, 3, 4, 5].map(day => w(day, 480, 1140)),
  openNow: true,
  today: 1,
  pause: { branchId: RIVERSIDE.id, pausedUntil: null, reason: null, pausedByName: null },
  version: 3,
}
const tableOf = (id: string, label: string, overrides: Partial<DiningTable> = {}): DiningTable => ({
  id,
  branchId: RIVERSIDE.id,
  label,
  area: 'Main floor',
  status: 'active',
  qrUrl: `http://localhost/table/${id.padEnd(22, 'x')}`,
  qrRotatedAt: STAMP,
  version: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
  deleteBlocker: null,
  ...overrides,
})
const T1 = tableOf('table-1', 'Table 01')
const T2 = tableOf('table-2', 'Patio 01', { area: 'Outdoor' })
const OLD = tableOf('table-3', 'Old bar', { status: 'archived', qrUrl: null, version: 2 })

/** A backend that answers what was last saved, like the real one. */
function backend(overrides: Record<string, MockHandler> = {}, branches = [RIVERSIDE]) {
  let settings = SETTINGS
  const tables = [T1, T2, OLD]
  const bodies: Record<string, unknown>[] = []
  const handlers: Record<string, MockHandler> = {
    'GET /admin/branches/options': () => branches,
    'GET /admin/branches/{id}': () => settings,
    'PATCH /admin/branches/{id}': ({ body }) => {
      bodies.push(body as Record<string, unknown>)
      const input = body as Partial<BranchSettings> & { version: number }
      settings = { ...settings, ...input, version: input.version + 1 } as BranchSettings
      return settings
    },
    'GET /admin/branches/{id}/tables': () => tables,
    ...overrides,
  }
  return { handlers, bodies }
}

async function open(handlers: Record<string, MockHandler>, width?: number, path = `/c/nuk/admin/branches/${RIVERSIDE.id}`) {
  const page = await createPage()
  if (width) await page.setViewportSize({ width, height: 844 })
  const api = await mockApi(page, handlers)
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, api }
}

const day = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true })
const timeField = (page: Page, label: string) => page.getByRole('group', { name: label })
async function typeTime(page: Page, label: string, digits: string) {
  await timeField(page, label).getByRole('spinbutton').first().click()
  await page.keyboard.type(digits)
}
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save changes' })

describe('branch page', () => {
  it('is in the sidebar; with one branch, /branches opens it', async () => {
    const page = await createPage()
    await mockApi(page, backend().handlers)
    await gotoViaSidebar(page, ['Branch'])
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/c/nuk/admin/branches/${RIVERSIDE.id}`)
    await page.getByRole('heading', { name: 'Branch settings' }).waitFor()
    expect(await page.title()).toBe('Branch · NUK Cafe Admin')
  })

  it('lists the branches when there are several', async () => {
    const { page } = await open(backend({}, [RIVERSIDE, AIRPORT]).handlers, undefined, '/c/nuk/admin/branches')
    await page.getByRole('list', { name: 'Branches' }).getByRole('link', { name: 'Airport' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/c/nuk/admin/branches/${AIRPORT.id}`)
  })
})

describe('adding a branch (D197)', () => {
  const NEW: BranchSettings = { ...SETTINGS, id: 'branch-9', name: 'Airport', address: null, hours: [], openNow: false, version: 1 }

  it('with one branch, adds from its page: the dialog starts on its time zone, then the new branch opens', async () => {
    let sent: unknown
    const branches = [RIVERSIDE]
    const { page, api } = await open(backend({
      'GET /admin/branches/options': () => branches,
      'GET /admin/branches/{id}': ({ url }) => (url.pathname.endsWith(NEW.id) ? NEW : SETTINGS),
      'POST /admin/branches': ({ body }) => {
        sent = body
        branches.push({ id: NEW.id, name: NEW.name })
        return NEW
      },
    }).handlers)
    await page.getByRole('button', { name: 'Add branch' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add branch' })
    await dialog.getByLabel('Name', { exact: true }).fill(' Airport ')
    await expect.poll(() => dialog.locator('[aria-label="Time zone"]').textContent()).toContain('Phnom Penh')
    await dialog.getByRole('button', { name: 'Add branch' }).click()
    await toast(page, 'Branch "Airport" added').waitFor()
    expect(sent).toEqual({ name: 'Airport', timezone: 'Asia/Phnom_Penh' })
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/c/nuk/admin/branches/${NEW.id}`)
    // Its page, now with the way back to the list of two.
    await page.getByRole('link', { name: 'All branches' }).waitFor()
    await expect.poll(() => api.calls.filter(c => c === 'POST /admin/branches').length).toBe(1)
  })

  it('needs a name, and shows a refused save in the dialog with the input kept', async () => {
    const { page, api } = await open(backend({
      'POST /admin/branches': () => {
        throw new MockFailure(409, 'BRANCH_NAME_TAKEN', 'There is already a branch named "Riverside".', { name: ['Already used by another branch'] })
      },
    }).handlers)
    await page.getByRole('button', { name: 'Add branch' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add branch' })
    await dialog.getByRole('button', { name: 'Add branch' }).click()
    await dialog.getByText('Name is required').waitFor()
    expect(api.calls.filter(c => c === 'POST /admin/branches')).toEqual([])
    await dialog.getByLabel('Name', { exact: true }).fill('Riverside')
    await dialog.getByRole('button', { name: 'Add branch' }).click()
    await dialog.getByText('There is already a branch named "Riverside".').waitFor()
    expect(await dialog.getByLabel('Name', { exact: true }).inputValue()).toBe('Riverside')
  })

  it('with several, adds from the list, which explains branches; at the limit the button is off', async () => {
    const several = Array.from({ length: 10 }, (_, i) => ({ id: `branch-${i + 1}`, name: `Branch ${i + 1}` }))
    const { page } = await open(backend({}, [RIVERSIDE, AIRPORT]).handlers, undefined, '/c/nuk/admin/branches')
    await page.getByText('Branches are your cafe\'s locations.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Add branch' }).click()
    await page.getByRole('dialog', { name: 'Add branch' }).waitFor()

    const full = await open(backend({}, several).handlers, undefined, '/c/nuk/admin/branches')
    await full.page.getByText('A cafe can have at most 10 branches.', { exact: false }).waitFor()
    expect(await full.page.getByRole('button', { name: 'Add branch' }).isDisabled()).toBe(true)
  })

  const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
  async function axeFindings(page: Page): Promise<string[]> {
    await page.evaluate(axeSource)
    return page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string, nodes: { target: string[] }[] }[] }> } }).axe
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).slice(0, 4).join(', ')}`)
    })
  }
  async function bothModes(page: Page) {
    // The pointer rests where the last click was: a hovered control isn't what's measured.
    await page.mouse.move(0, 0)
    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
    // Colours ease between the modes: measure once they have settled.
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.waitForTimeout(500)
    expect(await axeFindings(page)).toEqual([])
  }

  it.each([1440, 390])('the list and the dialog meet the rules in light and dark and fit at %ipx; a phone shows the branch page\'s button as an icon', async (width) => {
    const { page } = await open(backend({}, [RIVERSIDE, AIRPORT]).handlers, width, '/c/nuk/admin/branches')
    await page.getByRole('list', { name: 'Branches' }).waitFor()
    await bothModes(page)
    await page.getByRole('button', { name: 'Add branch' }).click()
    await page.getByRole('dialog', { name: 'Add branch' }).getByLabel('Name', { exact: true }).waitFor()
    await bothModes(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    const single = await open(backend().handlers, width)
    const button = single.page.getByRole('button', { name: 'Add branch' })
    await button.waitFor()
    const box = (await button.boundingBox())!
    expect(box.width < 60).toBe(width < 640)
  })
})

describe('a pause from the counter (D199)', () => {
  it('shows on the status card with who and why; Resume ends it', async () => {
    let resumed = 0
    const pause = { branchId: RIVERSIDE.id, pausedUntil: '2026-09-29T08:30:00.000Z', reason: 'Machine broken', pausedByName: 'Mony Chan' }
    const { page } = await open(backend({
      'GET /admin/branches/{id}': () => ({ ...SETTINGS, pause: resumed ? { ...pause, pausedUntil: null, reason: null, pausedByName: null } : pause }),
      'POST /admin/branches/{id}/resume': () => {
        resumed++
        return { ...pause, pausedUntil: null, reason: null, pausedByName: null }
      },
    }).handlers)
    await page.getByText('Paused until 3:30 PM').waitFor()
    await page.getByText('By Mony Chan · Machine broken').waitFor()
    await page.getByRole('button', { name: 'Resume' }).click()
    await toast(page, 'Online orders are on again').waitFor()
    await page.getByText('Open now').first().waitFor()
    expect(resumed).toBe(1)
    expect(await page.getByRole('button', { name: 'Resume' }).count()).toBe(0)
  })
})

describe('branch settings', () => {
  it('shows what\'s saved: open now, time zone, today\'s hours', async () => {
    const { page } = await open(backend().handlers)
    await page.getByText('Open now').waitFor()
    await page.getByText('UTC+7').waitFor()
    await page.getByText('8:00 AM – 7:00 PM').first().waitFor()
    expect(await day(page, 'Sunday').getByText('Closed all day').isVisible()).toBe(true)
    // Nothing to save yet.
    expect(await saveButton(page).isDisabled()).toBe(true)
  })

  it('saves the whole draft in one request from the version read: details, a second window, copied days', async () => {
    const { handlers, bodies } = backend()
    const { page } = await open(handlers)
    await page.getByLabel('Branch name').fill('NUK Cafe Riverside')
    await page.getByLabel('Phone').fill('012 345 678')
    await day(page, 'Monday').getByRole('button', { name: 'Add a window on Monday' }).click()
    await typeTime(page, 'Monday opens, window 2', '0800P')
    await typeTime(page, 'Monday closes, window 2', '1000P')
    await page.getByRole('button', { name: 'Copy Monday to weekdays' }).click()
    await day(page, 'Saturday').getByRole('switch').click()
    await saveButton(page).click()
    await toast(page, 'Branch settings saved').waitFor()

    const monToFri = [1, 2, 3, 4, 5].flatMap(d => [w(d, 480, 1140), w(d, 1200, 1320)])
    expect(bodies).toEqual([{
      version: 3,
      name: 'NUK Cafe Riverside',
      timezone: 'Asia/Phnom_Penh',
      address: '#123 St. 63',
      phone: '+85512345678',
      hours: [...monToFri, w(6, 480, 1140)],
    }])
    await expect.poll(() => saveButton(page).isDisabled()).toBe(true)
  })

  it('a window past midnight says so, and the server\'s overlap error shows on its window', async () => {
    const { handlers } = backend({
      'PATCH /admin/branches/{id}': () => {
        throw failures.validation('Overlaps another window (Monday 18:00–02:00).', { 'hours.1': ['Overlaps another window (Monday 18:00–02:00).'] })
      },
    })
    const { page } = await open(handlers)
    await typeTime(page, 'Monday closes, window 1', '0200A')
    await day(page, 'Monday').getByText('Closes the next day').waitFor()
    await saveButton(page).click()
    await day(page, 'Tuesday').getByText('Overlaps another window (Monday 18:00–02:00).').waitFor()
  })

  it('someone else saved first: Reload keeps the input and the next save names their version', async () => {
    let conflicted = false
    const { handlers, bodies } = backend()
    const patch = handlers['PATCH /admin/branches/{id}']!
    handlers['PATCH /admin/branches/{id}'] = (request) => {
      if (!conflicted) {
        conflicted = true
        throw failures.conflict('VERSION_CONFLICT', 'This branch was changed by someone else. Reload it and try again.')
      }
      return patch(request)
    }
    handlers['GET /admin/branches/{id}'] = () => ({ ...SETTINGS, version: 5 })
    const { page } = await open(handlers)
    await page.getByLabel('Branch name').fill('Mine')
    await saveButton(page).click()
    await page.getByText('Someone else changed these settings').waitFor()
    await page.getByRole('button', { name: 'Reload' }).click()
    await expect.poll(() => page.getByText('Someone else changed these settings').count()).toBe(0)
    expect(await page.getByLabel('Branch name').inputValue()).toBe('Mine')
    await saveButton(page).click()
    await toast(page, 'Branch settings saved').waitFor()
    expect(bodies.at(-1)).toMatchObject({ version: 5, name: 'Mine' })
  })

  it('switching tabs keeps the draft without asking; leaving the page asks', async () => {
    const { page } = await open(backend().handlers)
    await page.getByLabel('Branch name').fill('Draft name')
    await page.getByRole('tab', { name: /Dining tables/ }).click()
    await card(page, 'Table 01').waitFor()
    expect(await page.getByText('Discard unsaved changes?').count()).toBe(0)
    await page.getByRole('tab', { name: /Settings/ }).click()
    expect(await page.getByLabel('Branch name').inputValue()).toBe('Draft name')
    await page.getByRole('link', { name: 'Staff' }).click()
    await page.getByText('Discard unsaved changes?').waitFor()
  })

  it('warns when every day is closed', async () => {
    const { page } = await open(backend({ 'GET /admin/branches/{id}': () => ({ ...SETTINGS, hours: [], openNow: false }) }).handlers)
    await page.getByText('Closed every day').waitFor()
    await page.getByText('Closed now').waitFor()
    await page.getByText('Closed today').waitFor()
  })

  it('on phones: fits the screen, and Save appears at the bottom once there are changes', async () => {
    const { page } = await open(backend().handlers, 390)
    await page.getByRole('heading', { name: 'Branch settings' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const bar = page.getByRole('toolbar', { name: 'Save' })
    expect(await bar.count()).toBe(0)
    await page.getByLabel('Branch name').fill('On the phone')
    await page.getByLabel('Branch name').blur()
    await bar.getByRole('button', { name: 'Save changes' }).waitFor()
  })
})

describe('dining tables', () => {
  async function openTables(overrides: Record<string, MockHandler> = {}, width?: number) {
    const result = await open(backend(overrides).handlers, width, `/c/nuk/admin/branches/${RIVERSIDE.id}?tab=tables`)
    await card(result.page, 'Table 01').waitFor()
    return result
  }

  it('shows active tables with their QR codes and areas, counts, and archived ones on their tab', async () => {
    const { page } = await openTables()
    await card(page, 'Patio 01').getByText('Outdoor').waitFor()
    await card(page, 'Table 01').getByRole('img', { name: 'QR code for Table 01' }).waitFor()
    expect(await card(page, 'Old bar').count()).toBe(0)
    await expect.poll(() => page.getByRole('tab', { name: /Dining tables/ }).innerText()).toContain('2')
    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Old bar').getByRole('button', { name: 'Restore Old bar' }).waitFor()
    expect(await card(page, 'Old bar').getByRole('img').count()).toBe(0)
  })

  it('searches by name or area', async () => {
    const { page } = await openTables()
    await page.getByPlaceholder('Search tables…').fill('outdoor')
    await expect.poll(() => card(page, 'Table 01').count()).toBe(0)
    await card(page, 'Patio 01').waitFor()
  })

  it('shows a table\'s QR large, with its link and downloads', async () => {
    const { page } = await openTables()
    await card(page, 'Table 01').getByRole('button', { name: 'View QR for Table 01' }).click()
    const dialog = page.getByRole('dialog', { name: 'QR code: Table 01' })
    await dialog.getByRole('img', { name: 'QR code for Table 01' }).waitFor()
    expect(await dialog.getByLabel('QR link').inputValue()).toBe(T1.qrUrl)
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download SVG' }).click()])
    expect(download.suggestedFilename()).toBe('table-01-qr.svg')
  })

  it('adds a table with an area, and refuses a name another table has on its field', async () => {
    let tries = 0
    const bodies: unknown[] = []
    const { page } = await openTables({
      'POST /admin/branches/{id}/tables': ({ body }) => {
        bodies.push(body)
        if (++tries === 1) throw new MockFailure(409, 'TABLE_LABEL_TAKEN', 'There is already a table named "Table 01" in this branch.', { label: ['Already used by another table'] })
        return tableOf('table-9', 'Table 02')
      },
    })
    await page.getByRole('button', { name: 'New table' }).click()
    const form = page.getByRole('dialog', { name: 'New table' })
    await form.getByLabel('Name').fill('Table 01')
    await form.getByLabel('Area').fill('Main floor')
    await form.getByRole('button', { name: 'Add table' }).click()
    await form.getByText('Already used by another table').waitFor()
    await form.getByLabel('Name').fill('Table 02')
    await form.getByRole('button', { name: 'Add table' }).click()
    await toast(page, 'Table "Table 02" added').waitFor()
    expect(bodies).toEqual([{ label: 'Table 01', area: 'Main floor' }, { label: 'Table 02', area: 'Main floor' }])
  })

  it('a new QR code asks first, then shows the new one to print', async () => {
    const rotated = tableOf('table-1', 'Table 01', { qrUrl: 'http://localhost/table/newtokennewtokennewtok', version: 2 })
    const bodies: unknown[] = []
    const { page } = await openTables({
      'POST /admin/branches/{id}/tables/{id}/rotate-qr': ({ body }) => {
        bodies.push(body)
        return rotated
      },
    })
    await card(page, 'Table 01').getByRole('button', { name: 'New QR code for Table 01' }).click()
    await page.getByText('The printed QR code stops working at once.').waitFor()
    await page.getByRole('button', { name: 'New QR code', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'QR code: Table 01' })
    await expect.poll(() => dialog.getByLabel('QR link').inputValue()).toBe(rotated.qrUrl)
    expect(bodies).toEqual([{ version: 1 }])
  })

  it('archives from the menu at once with Undo (D152) and restores from the card, each from the version read', async () => {
    const bodies: Record<string, unknown[]> = { archive: [], restore: [] }
    const { page } = await openTables({
      'POST /admin/branches/{id}/tables/{id}/archive': ({ body }) => {
        bodies.archive!.push(body)
        return { ...T2, status: 'archived', qrUrl: null, version: 2 }
      },
      'POST /admin/branches/{id}/tables/{id}/restore': ({ body, url }) => {
        bodies.restore!.push(body)
        return url.pathname.includes(T2.id) ? { ...T2, version: 3 } : { ...OLD, status: 'active', qrUrl: T1.qrUrl, version: 3 }
      },
    })
    await page.getByRole('button', { name: 'Actions for Patio 01' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await toast(page, 'its QR code stops working until it\'s restored').waitFor()
    await toastAction(page, 'Table "Patio 01" archived', 'Undo').click()
    await toast(page, 'Table "Patio 01" restored').waitFor()
    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Old bar').getByRole('button', { name: 'Restore Old bar' }).click()
    await toast(page, 'Table "Old bar" restored').waitFor()
    expect(bodies).toEqual({ archive: [{ version: 1 }], restore: [{ version: 2 }, { version: 2 }] })
  })

  it('on phones: cards fit the screen, New table stays in reach', async () => {
    const { page } = await openTables({}, 390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'New table' }).waitFor()
  })
})

// The admin page shell (D126): the sidebar's active item, the tab in the URL, one line under
// toolbar tabs, the page width, and the time zone list drawn only where it's seen.
describe('deleting a table permanently (D200)', () => {
  it('deletes an archived table no order was placed at, after asking, from the version read', async () => {
    const rows = [T1, T2, OLD]
    const bodies: unknown[] = []
    const { page } = await open(backend({
      'GET /admin/branches/{id}/tables': () => rows,
      'DELETE /admin/branches/{id}/tables/{id}': ({ url: u, body }) => {
        bodies.push({ id: u.pathname.split('/').pop(), version: u.searchParams.get('version'), body })
        rows.splice(rows.indexOf(OLD), 1)
        return null
      },
    }).handlers, undefined, `/c/nuk/admin/branches/${RIVERSIDE.id}?tab=tables`)
    await card(page, 'Table 01').waitFor()
    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Old bar').getByRole('button', { name: 'Actions for Old bar' }).click()
    await page.getByRole('menuitem', { name: 'Delete permanently' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete "Old bar" permanently?' })
    await dialog.getByText('No order was placed at it.', { exact: false }).waitFor()
    await dialog.getByRole('button', { name: 'Delete permanently' }).click()
    await toast(page, 'Table "Old bar" deleted').waitFor()
    await card(page, 'Old bar').waitFor({ state: 'detached' })
    expect(bodies).toEqual([{ id: OLD.id, version: '2', body: null }])
  })

  it('says why a table with orders can\'t go', async () => {
    const USED = tableOf('table-4', 'Old patio', { status: 'archived', qrUrl: null, deleteBlocker: 'ordered' })
    const { page } = await open(backend({ 'GET /admin/branches/{id}/tables': () => [T1, USED] }).handlers, undefined, `/c/nuk/admin/branches/${RIVERSIDE.id}?tab=tables`)
    await card(page, 'Table 01').waitFor()
    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Old patio').getByRole('button', { name: 'Actions for Old patio' }).click()
    const action = page.getByRole('menuitem', { name: 'Delete permanently (it has orders)' })
    await action.waitFor()
    expect(await action.getAttribute('data-disabled')).not.toBeNull()
  })
})

describe('page shell (D126)', () => {
  const sidebarCurrent = (page: Page) => page.locator('nav a[aria-current="page"]').allTextContents()

  it('keeps Branches active in the sidebar on its page, on either tab, and keeps the tab in the URL', async () => {
    const { page } = await open(backend().handlers)
    await card(page, 'Current status').or(page.getByRole('heading', { name: 'Branch settings' })).first().waitFor()
    expect((await sidebarCurrent(page)).map(text => text.trim())).toEqual(['Branches'])
    await page.getByRole('tab', { name: /Dining tables/ }).click()
    await card(page, 'Table 01').waitFor()
    expect((await sidebarCurrent(page)).map(text => text.trim())).toEqual(['Branches'])
    expect(new URL(page.url()).searchParams.get('tab')).toBe('tables')

    // A reload opens the same tab; back on Settings the URL is clean again.
    await page.goto(page.url(), { waitUntil: 'hydration' })
    await card(page, 'Table 01').waitFor()
    await page.getByRole('tab', { name: /Settings/ }).click()
    await page.getByRole('heading', { name: 'Branch settings' }).waitFor()
    expect(new URL(page.url()).searchParams.has('tab')).toBe(false)
  })

  it('/branches?tab=tables opens the only branch on that tab', async () => {
    const { page } = await open(backend().handlers, undefined, '/c/nuk/admin/branches?tab=tables')
    await card(page, 'Table 01').waitFor()
    expect(new URL(page.url()).pathname).toBe(`/c/nuk/admin/branches/${RIVERSIDE.id}`)
  })

  it('draws one line under the tabs: the toolbar\'s, with the active tab\'s underline on it', async () => {
    const { page } = await open(backend().handlers)
    await page.getByRole('heading', { name: 'Branch settings' }).waitFor()
    const lines = await page.getByRole('tablist').first().evaluate((list) => {
      const toolbar = list.closest('[data-slot="root"]')!.parentElement!.closest('.border-b') ?? list.parentElement!.parentElement!
      const indicator = list.querySelector('[data-slot="indicator"]')!.getBoundingClientRect()
      const box = toolbar.getBoundingClientRect()
      return {
        listBorder: getComputedStyle(list).borderBottomWidth,
        toolbarBorder: getComputedStyle(toolbar).borderBottomWidth,
        // Inside the toolbar (its scrolling box clips anything lower), right above its line.
        indicatorShown: indicator.height > 0 && indicator.bottom <= box.bottom - 1 && indicator.bottom >= box.bottom - 2,
      }
    })
    expect(lines).toEqual({ listBorder: '0px', toolbarBorder: '1px', indicatorShown: true })
  })

  it('on a wide screen centers the page at the narrow width, the navbar lined up with it', async () => {
    const { page } = await open(backend().handlers, 1920)
    await page.getByRole('heading', { name: 'Branch settings' }).waitFor()
    const box = await page.getByRole('heading', { name: 'Branch settings' }).evaluate((heading) => {
      const body = heading.closest('[data-slot="body"]')!
      const panel = body.getBoundingClientRect()
      const content = heading.getBoundingClientRect()
      const title = document.querySelector('[data-slot="title"]')!.getBoundingClientRect()
      return { left: content.left - panel.left, right: panel.right - (content.left + body.clientWidth - parseFloat(getComputedStyle(body).paddingLeft) - parseFloat(getComputedStyle(body).paddingRight)), width: body.clientWidth - parseFloat(getComputedStyle(body).paddingLeft) - parseFloat(getComputedStyle(body).paddingRight), titleLeft: title.left - panel.left }
    })
    expect(box.width).toBe(896) // page-narrow: 56rem
    expect(Math.abs(box.left - box.right)).toBeLessThan(2)
    // The navbar's title starts where the content does (after the sidebar toggle).
    expect(box.titleLeft).toBeGreaterThanOrEqual(box.left)
    expect(box.titleLeft).toBeLessThan(box.left + 64)
  })

  it('draws only the time zones in view, and finds one by name', async () => {
    const { page } = await open(backend().handlers)
    await page.locator('[aria-label="Time zone"]').first().click()
    const search = page.getByPlaceholder('Search time zones…')
    await search.waitFor()
    // About 420 zones; only the visible rows (and a few more) are in the page.
    await expect.poll(() => page.getByRole('option').count()).toBeGreaterThan(5)
    expect(await page.getByRole('option').count()).toBeLessThan(40)
    await search.fill('phnom')
    await expect.poll(() => page.getByRole('option').allTextContents()).toEqual(['(UTC+07:00) Phnom Penh'])
  })
})

// The phone field (D127): a country flag beside the number, led by its code, sent as E.164.
describe('branch phone', () => {
  const phone = (page: Page) => page.getByLabel('Phone', { exact: true })
  const country = (page: Page) => page.getByRole('button', { name: 'Country code' })
  // The dial code leads the number's input; the country menu itself shows only the flag.
  const dialCode = (page: Page) => phone(page).locator('xpath=..').getByText(/^\+\d+$/)

  it('shows a saved number without its code, under its country\'s flag', async () => {
    const { page } = await open(backend({ 'GET /admin/branches/{id}': () => ({ ...SETTINGS, phone: '+85291234567' }) }).handlers)
    await expect.poll(() => phone(page).inputValue()).toBe('9123 4567')
    await expect.poll(() => dialCode(page).textContent()).toBe('+852')
  })

  it('a pasted full number switches the country; leaving drops the trunk 0; it saves as E.164', async () => {
    const { handlers, bodies } = backend()
    const { page } = await open(handlers)
    await phone(page).fill('+852 9123 4567')
    await expect.poll(() => phone(page).inputValue()).toBe('9123 4567')
    await expect.poll(() => dialCode(page).textContent()).toBe('+852')

    await country(page).click()
    await page.getByRole('option', { name: 'Cambodia (+855)' }).click()
    // The list hands focus back to its button as it closes: a fill() meanwhile lands before the old number.
    await page.getByRole('listbox').waitFor({ state: 'hidden' })
    await expect.poll(() => dialCode(page).textContent()).toBe('+855')
    await phone(page).fill('012345678')
    await phone(page).blur()
    await expect.poll(() => phone(page).inputValue()).toBe('12 345 678')
    await saveButton(page).click()
    await toast(page, 'Branch settings saved').waitFor()
    expect(bodies.at(-1)).toMatchObject({ phone: '+85512345678' })
  })

  it('names the country in the error for a wrong number, and sends nothing', async () => {
    const { handlers, bodies } = backend()
    const { page } = await open(handlers)
    await country(page).click()
    await page.getByRole('option', { name: 'Argentina (+54)' }).click()
    await phone(page).fill('1234')
    await saveButton(page).click()
    await page.getByText('Enter a valid Argentine phone number').waitFor()
    expect(bodies).toEqual([])
  })
})
