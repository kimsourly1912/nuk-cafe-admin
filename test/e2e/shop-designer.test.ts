import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { DiningTable } from '#shared/contracts/branches'
import type { BranchLayout, CustomLook, Point } from '#shared/contracts/shop-layout'
import { setupE2e } from './support/mock-api'
import { asNewVisitor } from './support/client-address'
import { allowBrowserProblems } from './support/browser-problems'

await setupE2e()

// The shop designer (D273, step 2b) on the built server and its seeded database, no mocks: Layout
// Lab's owner starts a branch's layout from a starter, places its real tables, edits floors,
// edges, doors and walls, saves and reopens it, and meets a stale save and a table archived
// elsewhere. Layout Lab is this file's own cafe, so no other file's saves race these. The tests
// run in order on one branch ("Lab Floor"); Blank drawing uses "Lab Annex".
// `SHOP_DESIGNER_SCREENSHOTS=1` keeps screenshots in output/playwright/shop-designer for review.

const seed = inject('shopSeed')
const lab = seed.layoutLab
const output = join(process.cwd(), 'output', 'playwright', 'shop-designer')
const branchPath = (branchId: string, view = 'design') => `/c/${lab.slug}/admin/branches/${branchId}?tab=tables&view=${view}`
const api = (branchId: string) => `/api/c/${lab.slug}/admin/branches/${branchId}`

async function signedIn(width = 1440, height = 900) {
  const page = await createPage()
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width, height })
  await asNewVisitor(page)
  await page.goto(url(`/c/${lab.slug}/admin/login`), { waitUntil: 'hydration' })
  await page.getByLabel('Email').fill(seed.customers.layoutOwner.email)
  await page.getByLabel('Password', { exact: true }).fill(seed.customers.layoutOwner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(address => address.pathname === `/c/${lab.slug}/admin`)
  return page
}

async function openDesign(page: Page, branchId = lab.branchId, view = 'design') {
  await page.goto(url(branchPath(branchId, view)), { waitUntil: 'hydration' })
}

async function shot(page: Page, name: string) {
  if (!process.env.SHOP_DESIGNER_SCREENSHOTS) return
  await mkdir(output, { recursive: true })
  await page.screenshot({ path: join(output, `${name}.png`) })
}

const plan = (page: Page) => page.getByTestId('floor-plan')
const unplaced = (page: Page, label: string) => page.getByTestId(`unplaced-${label}`)
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save layout' })
/** The 3D view's first frame is on screen. */
const drawn = (page: Page) => page.locator('[data-testid="building-canvas"][data-drawn="true"]').waitFor({ timeout: 40_000 })

/** Reads the layout as saved, with the page's own session. */
function savedLayout(page: Page, branchId = lab.branchId): Promise<BranchLayout> {
  return page.evaluate(path => fetch(path).then(response => response.json()), `${api(branchId)}/layout`)
}

/** Saves a layout with the page's session, as another device would. */
function saveElsewhere(page: Page, body: unknown): Promise<number> {
  return page.evaluate(([path, json]) => fetch(path!, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: json }).then(response => response.status), [`${api(lab.branchId)}/layout`, JSON.stringify(body)])
}

function branchTables(page: Page): Promise<DiningTable[]> {
  return page.evaluate(path => fetch(path).then(response => response.json()), `${api(lab.branchId)}/tables?status=all`)
}

async function save(page: Page) {
  await saveButton(page).click()
  await page.getByText('Shop layout saved').first().waitFor()
  await expect.poll(() => saveButton(page).isDisabled()).toBe(true)
}

/** Clicks the plan at a point in plan centimetres. */
async function clickPlan(page: Page, point: Point) {
  const at = await plan(page).evaluate((svg, target) => {
    const matrix = (svg as SVGSVGElement).getScreenCTM()!
    const screen = new DOMPoint(target.x, target.y).matrixTransform(matrix)
    return { x: screen.x, y: screen.y }
  }, point)
  await page.mouse.click(at.x, at.y)
}

/** A real PNG of `width` × `height`, drawn in the page (the crop dialog has to open it). */
async function pngFile(page: Page, width: number, height: number) {
  const bytes = await page.evaluate(async ([w, h]) => {
    const canvas = document.createElement('canvas')
    canvas.width = w!
    canvas.height = h!
    const context = canvas.getContext('2d')!
    context.fillStyle = '#3f6b55'
    context.fillRect(0, 0, w!, h!)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, [width, height])
  return { name: 'booth.png', mimeType: 'image/png', buffer: Buffer.from(bytes) }
}

const positionOf = async (page: Page, label: string) => {
  const transform = await plan(page).getByTestId(`plan-table-${label}`).getAttribute('transform')
  const [, x, y] = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform ?? '') ?? []
  return { x: Number(x), y: Number(y) }
}

describe('the shop designer on saved layouts', () => {
  it('starts from a starter, places a real table, saves, and shows it again on return', async () => {
    const page = await signedIn()
    const qrBefore = (await branchTables(page)).find(table => table.label === 'L1')!
    await openDesign(page)
    await page.getByRole('heading', { name: 'Start your shop layout' }).waitFor()
    await shot(page, 'starters')
    await page.getByTestId('starter-rooftop').click()
    await page.getByTestId('use-starter').click()
    await page.getByTestId('floor-tab-Ground').waitFor()
    await page.getByTestId('floor-tab-Rooftop').waitFor()
    // A starter draws the building only: every table waits unplaced.
    for (const label of ['L1', 'L2', 'L3']) await unplaced(page, label).waitFor()
    await page.getByTestId('layout-unsaved').waitFor()

    await unplaced(page, 'L1').getByRole('button', { name: 'Place on map' }).click()
    await plan(page).getByTestId('plan-table-L1').waitFor()
    await page.getByRole('button', { name: 'Move right 25 cm' }).click()
    await save(page)
    await shot(page, 'saved-L1')

    const layout = await savedLayout(page)
    expect(layout.version).toBe(1)
    expect(layout.floors.map(floor => [floor.name, floor.hasRoof])).toEqual([['Ground', true], ['Rooftop', false]])
    expect(layout.placements).toHaveLength(1)
    expect(layout.placements[0]).toMatchObject({ tableId: qrBefore.id, floorId: 'ground', lookId: 'round-cafe' })

    // Placing and moving a table never touches it: same version, same QR code.
    const qrAfter = (await branchTables(page)).find(table => table.label === 'L1')!
    expect(qrAfter.qrUrl).toBe(qrBefore.qrUrl)
    expect(qrAfter.version).toBe(qrBefore.version)

    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    expect(await saveButton(page).isDisabled()).toBe(true)
    expect(await unplaced(page, 'L1').count()).toBe(0)
  })

  it('adds a floor, sets it up from its menu, makes an edge a railing with a gate, draws a wall, and removes the floor', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await page.getByTestId('floor-tab-Ground').waitFor()

    await page.getByRole('button', { name: 'Add floor' }).click()
    await expect.poll(() => page.getByTestId('floor-tab-Second').getAttribute('aria-pressed')).toBe('true')
    // The floor menu (9B): rename, roof.
    await page.getByTestId('floor-menu').click()
    const menu = page.getByTestId('floor-menu-panel')
    await menu.getByLabel('Rename floor').fill('Loft')
    await menu.getByLabel('Rename floor').press('Enter')
    await page.getByTestId('floor-tab-Loft').waitFor()
    await menu.getByRole('switch', { name: 'Roof over this floor' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => menu.count()).toBe(0)

    await unplaced(page, 'L2').getByRole('button', { name: 'Place on map' }).click()
    await plan(page).getByTestId('plan-table-L2').waitFor()
    await page.getByRole('button', { name: 'Done' }).click()

    // An edge (3B): a railing, and a gate on it; windows need a wall.
    await plan(page).getByTestId('plan-edge-0').click({ force: true })
    const panel = page.getByRole('complementary', { name: 'Selected' })
    await panel.getByText('Back edge').waitFor()
    await panel.getByRole('button', { name: 'Railing' }).click()
    await panel.getByRole('button', { name: 'Gate' }).click()
    await panel.getByTestId('opening-door').waitFor()
    expect(await panel.getByRole('button', { name: 'Window' }).isDisabled()).toBe(true)
    await shot(page, 'edge-railing-gate')

    // Draw wall (9A): two clicks make a wall; Escape ends the chain.
    await page.getByRole('button', { name: 'Draw wall' }).click()
    await page.getByTestId('tool-bar').getByText('Draw wall').waitFor()
    await clickPlan(page, { x: 300, y: 100 })
    await clickPlan(page, { x: 300, y: 400 })
    await page.keyboard.press('Escape')
    await page.getByTestId('tool-bar').getByRole('button', { name: 'Done' }).click()
    await expect.poll(() => plan(page).locator('[data-testid^="plan-wall-"]').count()).toBe(1)
    await save(page)

    const saved = await savedLayout(page)
    const loft = saved.floors[2]!
    expect(loft).toMatchObject({ name: 'Loft', hasRoof: false })
    expect(loft.edges[0]).toMatchObject({ kind: 'railing', openings: [{ kind: 'door' }] })
    expect(loft.walls).toEqual([expect.objectContaining({ from: { x: 300, y: 100 }, to: { x: 300, y: 400 } })])
    expect(saved.placements.find(placement => placement.floorId === loft.id)).toBeTruthy()

    // Removing it names the table that goes back to Unplaced (6B).
    await page.getByTestId('floor-menu').click()
    await page.getByTestId('floor-menu-panel').getByRole('button', { name: 'Remove floor…' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Remove the Loft floor?' })
    await dialog.getByText('L2 will move to Unplaced tables. Its QR code keeps working.').waitFor()
    await dialog.getByRole('button', { name: 'Remove floor' }).click()
    await unplaced(page, 'L2').waitFor()
    expect(await page.getByTestId('floor-tab-Loft').count()).toBe(0)

    // A table look from the library asks which real table it is (2A).
    await page.getByTestId('look-oak-rectangle').click()
    const pick = page.getByRole('dialog').filter({ hasText: 'Which table is this?' })
    await pick.getByTestId('pick-L2').click()
    await plan(page).getByTestId('plan-table-L2').waitFor()
    expect(await unplaced(page, 'L2').count()).toBe(0)
    await save(page)
    const after = await savedLayout(page)
    expect(after.floors).toHaveLength(2)
    expect(after.placements.find(placement => placement.tableId === saved.placements.find(other => other.floorId === loft.id)!.tableId)).toMatchObject({ lookId: 'oak-rectangle', width: 120, depth: 80 })
  })

  it('a stale save keeps the draft: Load latest takes theirs (undo brings mine back), Overwrite with mine asks first', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('button', { name: 'Move down 25 cm' }).click()
    const mine = await positionOf(page, 'L1')

    // Another device saves meanwhile: L1 somewhere else.
    const before = await savedLayout(page)
    const theirs = { ...before.placements[0]!, x: 150, y: 300 }
    expect(await saveElsewhere(page, { version: before.version, layout: { floors: before.floors, placements: [theirs] } })).toBe(200)

    await saveButton(page).click()
    const conflict = page.getByTestId('layout-conflict')
    await conflict.getByText('This layout was changed somewhere else').waitFor()
    // Who saved the newer version (6A): here the same owner on "another device".
    await conflict.getByText(`Saved by ${seed.customers.layoutOwner.name}`, { exact: false }).waitFor()
    await shot(page, 'conflict')
    await conflict.getByRole('button', { name: 'Load latest' }).click()
    await expect.poll(() => conflict.count()).toBe(0)
    await expect.poll(() => positionOf(page, 'L1')).toEqual({ x: 150, y: 300 })
    expect(await saveButton(page).isDisabled()).toBe(true)
    // Undo puts my draft back, on top of the latest version: saving it now goes through.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => positionOf(page, 'L1')).toEqual(mine)
    await save(page)
    expect((await savedLayout(page)).placements[0]).toMatchObject({ x: mine.x, y: mine.y })

    // Again, and this time keep mine over theirs.
    const latest = await savedLayout(page)
    expect(await saveElsewhere(page, { version: latest.version, layout: { floors: latest.floors, placements: [{ ...latest.placements[0]!, x: 150, y: 300 }] } })).toBe(200)
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('button', { name: 'Move right 25 cm' }).click()
    const final = await positionOf(page, 'L1')
    await saveButton(page).click()
    await conflict.getByRole('button', { name: 'Overwrite with mine' }).click()
    const ask = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Overwrite with your draft?' })
    await ask.getByText('QR codes are not affected.', { exact: false }).waitFor()
    await ask.getByRole('button', { name: 'Overwrite' }).click()
    await page.getByText('Shop layout saved').first().waitFor()
    await expect.poll(() => conflict.count()).toBe(0)
    const overwritten = await savedLayout(page)
    expect(overwritten.version).toBe(latest.version + 2)
    expect(overwritten.placements[0]).toMatchObject({ x: final.x, y: final.y })
  })

  it('names a placed table archived elsewhere and takes it off the map before saving', async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('button', { name: 'Move up 25 cm' }).click()
    const moved = await positionOf(page, 'L1')
    await unplaced(page, 'L3').getByRole('button', { name: 'Place on map' }).click()
    await plan(page).getByTestId('plan-table-L3').waitFor()

    // Archived on another device while it's placed in this draft.
    const l3 = (await branchTables(page)).find(table => table.label === 'L3')!
    const archived = await page.evaluate(([path, version]) => fetch(path as string, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) }).then(response => response.status), [`${api(lab.branchId)}/tables/${l3.id}/archive`, l3.version] as const)
    expect(archived).toBe(200)

    await saveButton(page).click()
    const warning = page.getByTestId('layout-unavailable')
    await warning.getByText('L3 is no longer an active table here.').waitFor()
    await warning.getByRole('button', { name: 'Remove from map' }).click()
    await expect.poll(() => plan(page).getByTestId('plan-table-L3').count()).toBe(0)
    await expect.poll(() => warning.count()).toBe(0)
    // The refused save wrote nothing; the rest of the draft saves now.
    await save(page)
    const saved = await savedLayout(page)
    expect(saved.placements.map(placement => placement.tableId)).not.toContain(l3.id)
    expect(saved.tables.map(table => table.label)).not.toContain('L3')
    expect(saved.placements.find(placement => placement.floorId === 'ground')).toMatchObject({ x: moved.x, y: moved.y })
  })

  it('Blank: draws an outline corner by corner, then moves a corner with the keyboard', async () => {
    const page = await signedIn()
    await openDesign(page, lab.annexBranchId)
    await page.getByTestId('starter-blank').click()
    await page.getByTestId('use-starter').click()
    await expect.poll(() => plan(page).getAttribute('data-mode')).toBe('outline')
    for (const point of [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }, { x: 0, y: 0 }]) await clickPlan(page, point)
    await page.getByTestId('tool-bar').getByText('24 m²').waitFor()
    await shot(page, 'blank-outline')

    // A corner picked, then the arrow key: the corner next to it keeps the right angle.
    await plan(page).getByTestId('plan-corner-1').click()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => plan(page).getByTestId('plan-edge-length-0').textContent()).toBe('625 cm')
    await expect.poll(() => plan(page).getByTestId('plan-edge-length-1').textContent()).toBe('400 cm')
    await page.getByTestId('tool-bar').getByRole('button', { name: 'Done' }).click()

    await unplaced(page, 'A1').getByRole('button', { name: 'Place on map' }).click()
    await save(page)
    const layout = await savedLayout(page, lab.annexBranchId)
    expect(layout.floors[0]!.outline).toEqual([{ x: 0, y: 0 }, { x: 625, y: 0 }, { x: 625, y: 400 }, { x: 0, y: 400 }])
    expect(layout.floors[0]!.edges.every(edge => edge.kind === 'wall')).toBe(true)
  })

  it('finds a placed table on its floor in 3D, shows its QR code, and goes back to it on the plan', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page, lab.branchId, '3d')
    await drawn(page)
    const lists = page.getByRole('complementary', { name: 'Navigate the building' })
    await lists.getByTestId('list-table-L1').click()
    const card = page.getByTestId('table-card')
    await expect.poll(() => card.textContent()).toContain('Ground floor')
    await shot(page, '3d-L1')

    // The table's own QR code: the one the Table list shows.
    const l1 = (await branchTables(page)).find(table => table.label === 'L1')!
    await card.getByRole('button', { name: 'View QR' }).click()
    const dialog = page.getByRole('dialog', { name: 'QR code: L1' })
    expect(await dialog.getByLabel('QR link').inputValue()).toBe(l1.qrUrl)
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)

    await card.getByRole('button', { name: 'Show on plan' }).click()
    await expect.poll(() => page.getByTestId('selected-table').textContent()).toContain('L1')

    // The same table stays picked on the way back, and a change not saved yet is drawn and named.
    expect(await page.getByTestId('building-unsaved').count()).toBe(0)
    await page.getByRole('button', { name: 'Move up 25 cm' }).click()
    await page.getByRole('button', { name: 'View in 3D' }).first().click()
    await drawn(page)
    await page.getByTestId('building-unsaved').waitFor()
    await expect.poll(() => page.getByTestId('table-card').textContent()).toContain('L1')
    expect(await saveButton(page).isEnabled()).toBe(true)
  })

  it('without 3D graphics: a calm message, the lists and the table card still work, Try again draws it', { timeout: 60_000 }, async () => {
    // three.js reports the missing context itself before the view shows its message.
    allowBrowserProblems(/THREE\.WebGLRenderer: Error creating WebGL context/, /THREE\.WebGLRenderer: A WebGL context could not be created/)
    const page = await signedIn()
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      Object.assign(window, { webglOff: true })
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
        if ((window as { webglOff?: boolean }).webglOff && kind.startsWith('webgl')) return null
        return Reflect.apply(original, this, [kind, ...rest])
      } as typeof original
    })
    await openDesign(page, lab.branchId, '3d')
    const view = page.getByRole('main', { name: '3D view' })
    await view.getByText('3D view is not available here').waitFor()
    await shot(page, '3d-unavailable')

    const lists = page.getByRole('complementary', { name: 'Navigate the building' })
    await lists.getByTestId('list-table-L1').click()
    const card = page.getByTestId('table-card')
    await expect.poll(() => card.textContent()).toContain('Ground floor')
    await card.getByRole('button', { name: 'View QR' }).click()
    await page.getByRole('dialog', { name: 'QR code: L1' }).waitFor()
    await page.keyboard.press('Escape')

    await view.getByRole('button', { name: 'Try again' }).click()
    await view.getByText('3D view is not available here').waitFor()
    await page.evaluate(() => Object.assign(window, { webglOff: false }))
    await view.getByRole('button', { name: 'Try again' }).click()
    await drawn(page)
    expect(await view.getByText('3D view is not available here').count()).toBe(0)
    await expect.poll(() => card.textContent()).toContain('L1')
  })

  it('3D on a phone: the lists in a drawer, the table card above the controls, no sideways scrolling', { timeout: 60_000 }, async () => {
    const page = await signedIn(390, 844)
    await openDesign(page, lab.branchId, '3d')
    await drawn(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Floors and tables' }).click()
    await page.getByRole('dialog').getByTestId('list-table-L1').click()
    const card = page.getByTestId('table-card')
    await expect.poll(() => card.textContent()).toContain('Ground floor')
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    const box = (await card.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await shot(page, 'phone-3d')
    await card.getByRole('button', { name: 'Show on plan' }).click()
    await plan(page).getByTestId('plan-table-L1').waitFor()
  })

  it('works on a phone: the library in a slide-over, no sideways scrolling', async () => {
    const page = await signedIn(390, 844)
    await openDesign(page)
    await plan(page).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // A selected table's quick actions fit beside it, as icons.
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByTestId('quick-actions').getByRole('button', { name: 'Duplicate look' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await shot(page, 'phone-quick-actions')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Library' }).click()
    await page.getByRole('dialog').getByText('Unplaced tables').waitFor()
    await shot(page, 'phone-library')
  })

  it('custom looks: a new look from the library goes on a table, is edited, and deletes once no table uses it', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    const library = page.getByRole('complementary', { name: 'Library' })
    const form = () => page.getByRole('dialog', { name: /look$/i })

    // New look: a name is required; a rectangle on four legs in walnut.
    await library.getByRole('button', { name: 'New look' }).click()
    await form().getByRole('button', { name: 'Save look' }).click()
    await form().getByText('Name is required').waitFor()
    await form().getByLabel('Name').fill('Walnut window')
    await form().getByRole('group', { name: 'Shape' }).getByRole('button', { name: 'Rectangle' }).click()
    await form().getByRole('group', { name: 'Base' }).getByRole('button', { name: 'Four legs' }).click()
    await form().getByRole('group', { name: 'Tabletop' }).getByRole('button', { name: 'Walnut' }).click()
    await form().getByLabel('Width (cm)').fill('150')
    await shot(page, 'look-form')
    await form().getByRole('button', { name: 'Save look' }).click()
    await page.getByText('Look "Walnut window" saved').first().waitFor()
    await library.getByTestId('look-custom-Walnut window').waitFor()

    // The same name again is refused on its field.
    await library.getByRole('button', { name: 'New look' }).click()
    await form().getByLabel('Name').fill('walnut WINDOW')
    await form().getByRole('button', { name: 'Save look' }).click()
    await form().getByText('Already used by another look').waitFor()
    await form().getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect.poll(() => form().count()).toBe(0)

    // L1 takes it from its panel, and the layout saves with it.
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('combobox', { name: 'Look' }).click()
    await page.getByRole('option', { name: 'Walnut window' }).click()
    await save(page)
    const looks = () => page.evaluate(path => fetch(path).then(response => response.json()), `/api/c/${lab.slug}/admin/furniture-looks`) as Promise<CustomLook[]>
    const [look] = await looks()
    expect(look).toMatchObject({ name: 'Walnut window', shape: 'rect', base: 'legs', defaultWidth: 150, tables: 1, finishes: { top: 'walnut' } })
    const l1 = (await branchTables(page)).find(table => table.label === 'L1')!
    expect((await savedLayout(page)).placements.find(placement => placement.tableId === l1.id)).toMatchObject({ lookId: look!.id, width: 150 })

    // Editing it says who uses it and can't delete it; the rename shows in the library.
    await library.getByRole('button', { name: 'Edit the look Walnut window' }).click()
    await form().getByTestId('look-used').getByText('Used by 1 table').waitFor()
    expect(await form().getByRole('button', { name: 'Delete' }).isDisabled()).toBe(true)
    await form().getByLabel('Name').fill('Walnut bar')
    await form().getByRole('button', { name: 'Save', exact: true }).click()
    await library.getByTestId('look-custom-Walnut bar').waitFor()

    // Back on a built-in look and saved, the look deletes after a confirmation.
    await page.getByRole('combobox', { name: 'Look' }).click()
    await page.getByRole('option', { name: 'Round café table' }).click()
    await save(page)
    await library.getByRole('button', { name: 'Edit the look Walnut bar' }).click()
    await form().getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete the look "Walnut bar"?' }).getByRole('button', { name: 'Delete look' }).click()
    await page.getByText('Look "Walnut bar" deleted').first().waitFor()
    await expect.poll(() => library.getByTestId('look-custom-Walnut bar').count()).toBe(0)
    expect(await looks()).toEqual([])
  })

  it('a look\'s photo: uploaded in its form, shown in the picker, the table\'s panel and its 3D card, and removed again', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    const library = page.getByRole('complementary', { name: 'Library' })
    const form = () => page.getByRole('dialog', { name: /look$/i })
    const looks = () => page.evaluate(path => fetch(path).then(response => response.json()), `/api/c/${lab.slug}/admin/furniture-looks`) as Promise<CustomLook[]>

    // New look with a photo: framed 4:3 in the crop dialog, uploaded before the look is saved.
    await library.getByRole('button', { name: 'New look' }).click()
    await form().getByLabel('Name').fill('Corner sofa')
    const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/admin/media'))
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), form().getByRole('button', { name: 'Upload photo' }).click()])
    await chooser.setFiles(await pngFile(page, 800, 600))
    await page.getByRole('dialog', { name: 'Crop photo' }).getByRole('button', { name: 'Use photo' }).click()
    expect((await uploaded).status()).toBe(201)
    await form().getByRole('button', { name: 'Replace photo' }).waitFor()
    await shot(page, 'look-form-photo')
    await form().getByRole('button', { name: 'Save look' }).click()
    await page.getByText('Look "Corner sofa" saved').first().waitFor()

    // The picker shows the real piece, served from the cafe's media.
    const look = (await looks()).find(candidate => candidate.name === 'Corner sofa')!
    expect(look.photo?.url).toMatch(/^\/media\//)
    const pickerPhoto = library.getByTestId('look-custom-Corner sofa').getByTestId('look-photo')
    expect(await pickerPhoto.getAttribute('src')).toBe(look.photo!.url)
    await expect.poll(() => pickerPhoto.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    // L1 takes it: its panel and, after saving, its 3D card show the photo.
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('combobox', { name: 'Look' }).click()
    await page.getByRole('option', { name: 'Corner sofa' }).click()
    await page.getByTestId('selected-table').getByRole('img', { name: 'Photo of Corner sofa' }).waitFor()
    await save(page)
    await shot(page, 'look-photo-panel')
    await page.getByRole('button', { name: 'View in 3D' }).first().click()
    await page.getByTestId('table-card').getByRole('img', { name: 'Photo of Corner sofa' }).waitFor()

    // Save as new look starts from its shape, never its photo: an upload is one look's only.
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('button', { name: 'Save as new look' }).click()
    await form().getByRole('button', { name: 'Upload photo' }).waitFor()
    await form().getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => form().count()).toBe(0)

    // Removed in the form: the picker shows the shape again.
    await library.getByRole('button', { name: 'Edit the look Corner sofa' }).click()
    await form().getByRole('button', { name: 'Remove' }).click()
    await form().getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Look "Corner sofa" saved').first().waitFor()
    await expect.poll(() => library.getByTestId('look-custom-Corner sofa').getByTestId('look-photo').count()).toBe(0)
    expect((await looks()).find(candidate => candidate.id === look.id)).toMatchObject({ photo: null, version: 2 })

    // Back on the standard look, the look deletes, leaving the branch as the next test expects.
    await page.getByRole('combobox', { name: 'Look' }).click()
    await page.getByRole('option', { name: 'Round café table' }).click()
    await save(page)
    await library.getByRole('button', { name: 'Edit the look Corner sofa' }).click()
    await form().getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete the look "Corner sofa"?' }).getByRole('button', { name: 'Delete look' }).click()
    await page.getByText('Look "Corner sofa" deleted').first().waitFor()
  })

  it('a look deleted elsewhere while a draft uses it is named, and the standard look lets the layout save', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    const created = await page.evaluate(path => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Short lived', shape: 'round', base: 'pedestal', chair: 'bar-stool', finishes: { top: 'white-marble', base: 'brass' }, defaultWidth: 70, defaultDepth: 70 }) }).then(response => response.json()), `/api/c/${lab.slug}/admin/furniture-looks`) as CustomLook
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('combobox', { name: 'Look' }).click()
    await page.getByRole('option', { name: 'Short lived' }).click()
    // Deleted on another device: no saved layout uses it yet.
    const deleted = await page.evaluate(path => fetch(path, { method: 'DELETE' }).then(response => response.status), `/api/c/${lab.slug}/admin/furniture-looks/${created.id}?version=1`)
    expect(deleted).toBe(204)

    const before = (await savedLayout(page)).version
    await saveButton(page).click()
    const warning = page.getByTestId('layout-unknown-looks')
    await warning.getByText('The look of L1 was deleted.').waitFor()
    expect((await savedLayout(page)).version).toBe(before)
    await warning.getByRole('button', { name: 'Use Round café table' }).click()
    await expect.poll(() => warning.count()).toBe(0)
    await save(page)
    const l1 = (await branchTables(page)).find(table => table.label === 'L1')!
    expect((await savedLayout(page)).placements.find(placement => placement.tableId === l1.id)).toMatchObject({ lookId: 'round-cafe' })
  })

  it('quick actions beside the selection: a corner handle resizes, Rotate 90°, Duplicate look asks which table, Remove from map', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    const panel = page.getByRole('complementary', { name: 'Selected' })
    const quick = page.getByTestId('quick-actions')
    const l1 = plan(page).getByTestId('plan-table-L1')
    await l1.click()
    await quick.waitFor()
    await shot(page, 'quick-actions')
    expect(await l1.getAttribute('transform')).toContain('rotate(0)')
    const width = () => panel.getByLabel('Width (cm)').inputValue()
    const before = Number(await width())

    // L1 has a round look: its bottom-right handle, dragged 40 cm out, grows it both ways in one undo step.
    const handle = (await plan(page).getByTestId('resize-handle-2').boundingBox())!
    const scale = await plan(page).evaluate(svg => (svg as SVGSVGElement).getScreenCTM()!.a)
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 40 * scale, start.y + 40 * scale, { steps: 5 })
    await page.mouse.up()
    await expect.poll(width).toBe(String(before + 40))
    expect(await panel.getByLabel('Depth (cm)').inputValue()).toBe(String(before + 40))
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(width).toBe(String(before))
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(width).toBe(String(before + 40))

    await quick.getByRole('button', { name: 'Rotate 90°' }).click()
    await expect.poll(() => l1.getAttribute('transform')).toContain('rotate(90)')

    // Duplicate look: which table? A new one, saved at once, goes beside L1 with L1's look, size and turn.
    await quick.getByRole('button', { name: 'Duplicate look' }).click()
    await page.getByRole('dialog').filter({ hasText: 'Which table is this?' }).getByRole('button', { name: 'New table' }).click()
    const form = page.getByRole('dialog', { name: 'New table' })
    await form.getByLabel('Name').fill('L4')
    await form.getByRole('button', { name: 'Add table' }).click()
    await plan(page).getByTestId('plan-table-L4').waitFor()
    await expect.poll(() => quick.getAttribute('aria-label')).toBe('L4 quick actions')
    await save(page)
    const ids = Object.fromEntries((await branchTables(page)).map(table => [table.label, table.id]))
    const saved = await savedLayout(page)
    const original = saved.placements.find(placement => placement.tableId === ids.L1)!
    const copy = saved.placements.find(placement => placement.tableId === ids.L4)!
    expect(original).toMatchObject({ width: before + 40, depth: before + 40, rotation: 90 })
    expect(copy).toMatchObject({ floorId: original.floorId, lookId: original.lookId, width: original.width, depth: original.depth, rotation: 90, y: original.y })
    expect(copy.x).toBeGreaterThan(original.x)

    // Remove from map: L4 goes back to Unplaced tables.
    await quick.getByRole('button', { name: 'Remove from map' }).click()
    await unplaced(page, 'L4').waitFor()
    await expect.poll(() => quick.count()).toBe(0)

    // Furniture: Duplicate copies it beside itself.
    const plants = await plan(page).getByTestId('plan-item-plant').count()
    await page.getByTestId('catalog-plant').click()
    await quick.getByRole('button', { name: 'Duplicate', exact: true }).click()
    await expect.poll(() => plan(page).getByTestId('plan-item-plant').count()).toBe(plants + 2)
    await save(page)
    const items = (await savedLayout(page)).floors.find(floor => floor.id === original.floorId)!.items.filter(item => item.kind === 'plant')
    expect(items).toHaveLength(plants + 2)
    expect((await savedLayout(page)).placements.map(placement => placement.tableId)).not.toContain(ids.L4)
  })

  it('types a length on the plan\'s label, and walls and edges have quick actions too', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    const quick = page.getByTestId('quick-actions')
    const ground = (await savedLayout(page)).floors.find(floor => floor.id === 'ground')!
    const right = Math.max(...ground.outline.map(point => point.x))
    const top = Math.min(...ground.outline.map(point => point.y))

    // An inside wall's quick action: Delete wall (drawn just outside the building, where nothing covers it).
    const walls = () => plan(page).locator('[data-testid^="plan-wall-"]').count()
    const before = await walls()
    await page.getByRole('button', { name: 'Draw wall' }).click()
    await clickPlan(page, { x: right + 80, y: top })
    await clickPlan(page, { x: right + 80, y: top + 200 })
    await page.keyboard.press('Escape')
    await page.getByTestId('tool-bar').getByRole('button', { name: 'Done' }).click()
    await expect.poll(walls).toBe(before + 1)
    await clickPlan(page, { x: right + 80, y: top + 100 })
    await quick.getByRole('button', { name: 'Delete wall' }).click()
    await expect.poll(walls).toBe(before)

    // Draw outline (3A): a click on a length label makes it a field; Escape leaves it, Enter sets it.
    await page.getByRole('button', { name: 'Draw outline' }).click()
    const label = plan(page).getByTestId('plan-edge-length-1')
    const length = Number((await label.textContent())!.replace(' cm', ''))
    const field = page.getByTestId('edge-length-edit').getByRole('spinbutton')
    await label.click()
    await field.fill(String(length + 100))
    await field.press('Escape')
    await expect.poll(() => field.count()).toBe(0)
    expect(await label.textContent()).toBe(`${length} cm`)
    await label.click()
    expect(await field.inputValue()).toBe(String(length))
    await field.fill(String(length + 100))
    await shot(page, 'edge-length-typed')
    await field.press('Enter')
    await expect.poll(() => label.textContent()).toBe(`${length + 100} cm`)
    await page.getByTestId('tool-bar').getByRole('button', { name: 'Done' }).click()

    // An edge's quick actions: its type and a gate, a quarter of the way along it.
    const edge = await plan(page).getByTestId('plan-edge-2').evaluate(line => ['x1', 'y1', 'x2', 'y2'].map(name => Number(line.getAttribute(name))))
    await clickPlan(page, { x: edge[0]! + (edge[2]! - edge[0]!) / 4, y: edge[1]! + (edge[3]! - edge[1]!) / 4 })
    await quick.getByRole('group', { name: 'Edge type' }).waitFor()
    await quick.getByRole('button', { name: 'Railing' }).click()
    await expect.poll(() => quick.getByRole('button', { name: 'Railing' }).getAttribute('aria-pressed')).toBe('true')
    expect(await quick.getByRole('button', { name: 'Add a window' }).count()).toBe(0)
    const gates = () => page.getByRole('complementary', { name: 'Selected' }).getByTestId('opening-door').count()
    const gatesBefore = await gates()
    await quick.getByRole('button', { name: 'Add a gate' }).click()
    await expect.poll(gates).toBe(gatesBefore + 1)
    await shot(page, 'edge-quick-actions')

    await save(page)
    const saved = (await savedLayout(page)).floors.find(floor => floor.id === 'ground')!
    expect(Math.round(Math.hypot(saved.outline[2]!.x - saved.outline[1]!.x, saved.outline[2]!.y - saved.outline[1]!.y))).toBe(length + 100)
    expect(saved.edges[2]!.kind).toBe('railing')
    expect(saved.edges[2]!.openings.filter(opening => opening.kind === 'door')).toHaveLength(gatesBefore + 1)
    expect(saved.walls).toHaveLength(ground.walls.length)
  })
})
