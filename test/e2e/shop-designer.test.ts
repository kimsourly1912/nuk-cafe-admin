import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { DiningTable } from '#shared/contracts/branches'
import type { BranchLayout, Point } from '#shared/contracts/shop-layout'
import { setupE2e } from './support/mock-api'
import { asNewVisitor } from './support/client-address'

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

  it('finds a placed table on its floor in 3D and goes back to it on the plan', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page, lab.branchId, '3d')
    await drawn(page)
    const lists = page.getByRole('complementary', { name: 'Navigate the building' })
    await lists.getByTestId('list-table-L1').click()
    await expect.poll(() => page.getByTestId('table-card').textContent()).toContain('Ground floor')
    await shot(page, '3d-L1')
    await page.getByTestId('table-card').getByRole('button', { name: 'Show on plan' }).click()
    await expect.poll(() => page.getByTestId('selected-table').textContent()).toContain('L1')
  })

  it('works on a phone: the library in a slide-over, no sideways scrolling', async () => {
    const page = await signedIn(390, 844)
    await openDesign(page)
    await plan(page).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Library' }).click()
    await page.getByRole('dialog').getByText('Unplaced tables').waitFor()
    await shot(page, 'phone-library')
  })
})
