import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { afterEach, describe, expect, inject, it } from 'vitest'
import type { DiningTable } from '#shared/contracts/branches'
import { FIGURE_SIZES } from '#shared/contracts/shop-layout'
import type { BranchLayout, CustomItemLook, CustomLook, Point } from '#shared/contracts/shop-layout'
import { setupE2e } from './support/mock-api'
import { asNewVisitor } from './support/client-address'
import { allowBrowserProblems } from './support/browser-problems'

const pages: Page[] = []
afterEach(async () => {
  await Promise.all(pages.splice(0).map(page => page.context().close()))
})
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
  pages.push(page)
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
const studioPanels = (page: Page) => page.getByRole('navigation', { name: 'Studio panels' })
/** Opens a panel of the sidebar; below 1024 px the sidebar opens over the plan first (D277). */
async function showPanel(page: Page, name: 'Floors' | 'Tables' | 'Assets' | 'Manage looks') {
  const open = page.getByRole('button', { name: 'Open Studio sidebar' })
  await studioPanels(page).or(open).first().waitFor()
  if (!(await studioPanels(page).isVisible())) await open.click()
  await studioPanels(page).getByRole('button', { name, exact: true }).click()
}

async function placeTable(page: Page, label: string) {
  await showPanel(page, 'Tables')
  await unplaced(page, label).getByRole('button', { name: 'Place on map' }).click()
  await page.getByRole('button', { name: 'Place at center' }).click()
}

/** Assets' create menu (D277): New look, then New table look. */
async function newTableLook(library: Locator) {
  await library.getByRole('button', { name: 'New look' }).click()
  await library.page().getByRole('menuitem', { name: 'New table look' }).click()
}

/** Edit points and Draw wall are toolbar tools of their own (D278). */
async function drawWith(page: Page, name: 'Draw wall' | 'Edit points') {
  await page.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('button', { name, exact: true }).click()
  await page.getByTestId('tool-bar').getByText(name).waitFor()
}

/** Right-clicks a piece on the plan and picks an action from Studio's menu (D278). An item's name ends with its keys. */
async function fromMenu(target: Locator, name: string) {
  await target.click({ button: 'right' })
  const menu = target.page().getByRole('menu')
  await menu.getByRole('menuitem', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click()
  await menu.waitFor({ state: 'hidden' })
}

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

/**
 * The layout saved: Studio saves itself a moment after a change (ISS-027), so Save layout may have
 * nothing left to do; when it still can, it saves at once. Either way: the status says Saved.
 */
async function save(page: Page) {
  if (await saveButton(page).isEnabled()) await saveButton(page).click({ timeout: 3_000 }).catch(() => undefined)
  await expect.poll(() => saveButton(page).isDisabled(), { timeout: 15_000 }).toBe(true)
  await page.getByRole('status').filter({ hasText: /^Saved$/ }).first().waitFor()
}

/** Screen pixels for a point in plan centimetres. */
function onScreen(page: Page, point: Point): Promise<Point> {
  return plan(page).evaluate((svg, target) => {
    const screen = new DOMPoint(target.x, target.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  }, point)
}

/** Drags on the plan from one point to another, in plan centimetres, with keys held (D278's tools). */
async function dragPlan(page: Page, from: Point, to: Point, keys: string[] = []) {
  const start = await onScreen(page, from)
  const end = await onScreen(page, to)
  await page.mouse.move(start.x, start.y)
  for (const key of keys) await page.keyboard.down(key)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  for (const key of keys) await page.keyboard.up(key)
}

/** Clicks the plan at a point in plan centimetres. */
async function clickPlan(page: Page, point: Point) {
  const at = await plan(page).evaluate((svg, target) => {
    const matrix = (svg as SVGSVGElement).getScreenCTM()!
    const screen = new DOMPoint(target.x, target.y).matrixTransform(matrix)
    return { x: screen.x, y: screen.y }
  }, point)
  await expect.poll(() => plan(page).evaluate((svg, point) => svg.contains(document.elementFromPoint(point.x, point.y)), at)).toBe(true)
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
    await showPanel(page, 'Tables')
    // A starter draws the building only: every table waits unplaced.
    for (const label of ['L1', 'L2', 'L3']) await unplaced(page, label).waitFor()
    await page.getByTestId('layout-unsaved').waitFor()

    const card = unplaced(page, 'L1')
    const start = (await card.getByText('L1', { exact: true }).boundingBox())!
    const target = await plan(page).evaluate((svg) => {
      const point = new DOMPoint(113, 303).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
      return { x: point.x, y: point.y }
    })
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    // A drop lands on the whole centimetre under the pointer (ISS-004, Figma's pixel grid).
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 5 })
    await expect.poll(() => plan(page).getByTestId('plan-ghost').getAttribute('transform')).toBe('translate(113 303)')
    await page.mouse.up()
    await expect.poll(() => positionOf(page, 'L1')).toEqual({ x: 113, y: 303 })
    await page.getByRole('button', { name: 'Undo' }).click()
    await card.waitFor()
    await page.getByRole('group', { name: 'Position and rotation' }).waitFor({ state: 'hidden' })

    await card.getByRole('button', { name: 'Place on map' }).click()
    await clickPlan(page, { x: 125, y: 300 })
    await plan(page).getByTestId('plan-table-L1').waitFor()
    await plan(page).press('ArrowRight')
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
    await showPanel(page, 'Tables')
    expect(await unplaced(page, 'L1').count()).toBe(0)
  })

  it('adds a floor, sets it up from its menu, makes an edge a railing with a gate, draws a wall, and removes the floor', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await page.getByTestId('floor-tab-Ground').waitFor()

    await page.getByRole('button', { name: 'Add floor' }).click()
    // Add floor (D277): the new floor is shown with its name ready to type; Enter keeps it.
    const floorName = page.getByRole('textbox', { name: 'New floor name' })
    await expect.poll(() => floorName.evaluate(input => input === document.activeElement)).toBe(true)
    expect(await floorName.inputValue()).toBe('Second')
    await floorName.fill('Loft')
    await floorName.press('Enter')
    await expect.poll(() => page.getByTestId('floor-tab-Loft').getAttribute('aria-pressed')).toBe('true')
    // The floor's settings (9B) are in Properties while nothing is selected (D277): roof.
    const floorSettings = page.getByTestId('floor-settings')
    await floorSettings.getByRole('switch', { name: 'Roof over this floor' }).click()

    // A new floor's frame goes beside the others on its page (ISS-036), drawn there read only; a
    // click on one opens that floor, the plan staying still.
    // Shift+1 fits the whole page, like Figma: every frame on it.
    await page.keyboard.press('Shift+1')
    const ground = plan(page).getByTestId('plan-other-frame-Ground')
    await ground.waitFor()
    const groundBox = (await ground.boundingBox())!
    const planBox = (await plan(page).boundingBox())!
    expect(groundBox.x).toBeGreaterThanOrEqual(planBox.x)
    expect(groundBox.x + groundBox.width).toBeLessThanOrEqual(planBox.x + planBox.width)
    await page.mouse.click(groundBox.x + groundBox.width / 2, groundBox.y + groundBox.height / 2)
    await expect.poll(() => page.getByTestId('floor-tab-Ground').getAttribute('aria-pressed')).toBe('true')
    await page.getByTestId('floor-tab-Loft').click()
    await expect.poll(() => page.getByTestId('floor-tab-Loft').getAttribute('aria-pressed')).toBe('true')
    // Pages (ISS-036): a new one shows empty; a page with no floors can be deleted.
    await page.getByRole('button', { name: 'Add page' }).click()
    await page.getByTestId('plan-empty-page').waitFor()
    await page.getByTestId('page-Floors').click()
    await expect.poll(() => page.getByTestId('floor-tab-Loft').count()).toBe(1)
    await page.getByTestId('page-Page 2-row').hover()
    await page.getByRole('button', { name: 'Delete page Page 2' }).click()
    await expect.poll(() => page.getByTestId('page-Page 2').count()).toBe(0)
    await page.getByTestId('floor-tab-Loft').click()

    // The floor is a frame (ISS-035): dragged by its name, it moves; its drawing keeps its own coordinates.
    const frameXBefore = Number(await floorSettings.getByLabel('Frame X (cm)').inputValue())
    const label = (await plan(page).getByTestId('plan-frame-label').boundingBox())!
    const cm = await plan(page).evaluate(svg => (svg as SVGSVGElement).getScreenCTM()!.a)
    await page.mouse.move(label.x + 10, label.y + label.height / 2)
    await page.mouse.down()
    await page.mouse.move(label.x + 10 + 120 * cm, label.y + label.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Math.abs(Number(await floorSettings.getByLabel('Frame X (cm)').inputValue()) - frameXBefore - 120)).toBeLessThanOrEqual(1)
    expect(frameXBefore).toBeGreaterThan(0)
    // Floor order (owner: it matters): the new top floor goes down one and back up.
    await floorSettings.getByText('Order: 3 of 3').waitFor()
    await floorSettings.getByTestId('floor-down').click()
    await floorSettings.getByText('Order: 2 of 3').waitFor()
    await floorSettings.getByTestId('floor-up').click()
    await floorSettings.getByText('Order: 3 of 3').waitFor()

    await placeTable(page, 'L2')
    await plan(page).getByTestId('plan-table-L2').waitFor()
    await plan(page).press('Escape')

    // An edge (3B): a railing, and a gate on it; windows need a wall.
    await plan(page).getByTestId('plan-edge-0').click({ force: true })
    const panel = page.getByRole('complementary', { name: 'Properties' })
    await panel.getByText('Back edge').waitFor()
    await panel.getByRole('button', { name: 'Railing' }).click()
    await panel.getByRole('button', { name: 'Gate' }).click()
    await panel.getByTestId('opening-door').waitFor()
    expect(await panel.getByRole('button', { name: 'Window' }).isDisabled()).toBe(true)
    await shot(page, 'edge-railing-gate')

    // Draw wall (9A): two clicks make a wall; Enter ends the chain.
    await drawWith(page, 'Draw wall')
    await page.getByTestId('tool-bar').getByText('Draw wall').waitFor()
    await clickPlan(page, { x: 300, y: 100 })
    await clickPlan(page, { x: 300, y: 400 })
    await page.keyboard.press('Enter')
    // Any angle by default; a click on the chain's first point closes the loop and ends it (ISS-018).
    for (const point of [{ x: 500, y: 100 }, { x: 700, y: 175 }, { x: 550, y: 350 }, { x: 500, y: 100 }]) await clickPlan(page, point)
    await expect.poll(() => plan(page).locator('[data-testid^="plan-wall-"]').count()).toBe(4)
    await clickPlan(page, { x: 800, y: 400 })
    await clickPlan(page, { x: 800, y: 400 })
    expect(await plan(page).locator('[data-testid^="plan-wall-"]').count()).toBe(4)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    // Escape ends the chain and leaves the tool.
    await page.keyboard.press('Escape')
    await page.getByTestId('tool-bar').waitFor({ state: 'detached' })
    await expect.poll(() => plan(page).locator('[data-testid^="plan-wall-"]').count()).toBe(1)
    await save(page)

    const saved = await savedLayout(page)
    const loft = saved.floors[2]!
    expect(loft).toMatchObject({ name: 'Loft', hasRoof: false })
    expect(loft.canvasX).toBeGreaterThan(120)
    expect(loft.outline).toEqual(saved.floors[1]!.outline)
    expect(loft.edges[0]).toMatchObject({ kind: 'railing', openings: [{ kind: 'door' }] })
    expect(loft.walls).toEqual([expect.objectContaining({ from: { x: 300, y: 100 }, to: { x: 300, y: 400 } })])
    expect(saved.placements.find(placement => placement.floorId === loft.id)).toBeTruthy()

    // Removing it names the table that goes back to Unplaced (6B).
    await plan(page).press('Escape')
    await floorSettings.getByRole('button', { name: 'Remove floor…' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Remove the Loft floor?' })
    await dialog.getByText('L2 will move to Unplaced tables. Its QR code keeps working.').waitFor()
    await dialog.getByRole('button', { name: 'Remove floor' }).click()
    await unplaced(page, 'L2').waitFor()
    await showPanel(page, 'Floors')
    expect(await page.getByTestId('floor-tab-Loft').count()).toBe(0)

    // A table look from the library asks which real table it is (2A).
    await showPanel(page, 'Assets')
    await page.getByTestId('look-oak-rectangle').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    const pick = page.getByRole('dialog').filter({ hasText: 'Which table is this?' })
    await pick.getByTestId('pick-L2').click()
    await plan(page).getByTestId('plan-table-L2').waitFor()
    await showPanel(page, 'Tables')
    expect(await unplaced(page, 'L2').count()).toBe(0)
    await save(page)
    const after = await savedLayout(page)
    expect(after.floors).toHaveLength(2)
    expect(after.placements.find(placement => placement.tableId === saved.placements.find(other => other.floorId === loft.id)!.tableId)).toMatchObject({ lookId: 'oak-rectangle', width: 120, depth: 80 })
  })

  it('a stale save keeps the draft: Load latest takes theirs (undo brings mine back), Overwrite with mine asks first', { timeout: 120_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await plan(page).press('ArrowDown')
    const mine = await positionOf(page, 'L1')

    // Another device saves meanwhile: L1 somewhere else.
    const before = await savedLayout(page)
    const theirs = { ...before.placements[0]!, x: 150, y: 300 }
    expect(await saveElsewhere(page, { version: before.version, layout: { floors: before.floors, placements: [theirs] } })).toBe(200)

    await plan(page).press('Escape')
    const views = page.getByRole('group', { name: 'Layout view' })
    await views.getByRole('button', { name: '3D', exact: true }).click()
    // CI uses software WebGL. Wait until startup measurement stops scheduling frames.
    await page.getByTestId('quality').waitFor({ timeout: 45_000 })
    await saveButton(page).click()
    const conflict = page.getByTestId('layout-conflict')
    await conflict.getByText('This layout was changed somewhere else').waitFor()
    // Who saved the newer version (6A): here the same owner on "another device".
    await conflict.getByText(`Saved by ${seed.customers.layoutOwner.name}`, { exact: false }).waitFor()
    await shot(page, 'conflict')
    await conflict.getByRole('button', { name: 'Load latest' }).click()
    await expect.poll(() => conflict.count()).toBe(0)
    await views.getByRole('button', { name: '2D', exact: true }).click()
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
    await plan(page).press('ArrowRight')
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
    await plan(page).press('ArrowUp')
    const moved = await positionOf(page, 'L1')
    await placeTable(page, 'L3')
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

    // A corner picked, then the arrow key: only that corner moves, like Figma's point nudge (ISS-019).
    await plan(page).getByTestId('plan-corner-1').click()
    // Shift+arrow is 10 cm (ISS-004), twice.
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => plan(page).getByTestId('plan-edge-length-0').textContent()).toBe('620 cm')
    await page.getByTestId('tool-bar').getByRole('button', { name: 'Done' }).click()

    await placeTable(page, 'A1')
    await save(page)
    const layout = await savedLayout(page, lab.annexBranchId)
    expect(layout.floors[0]!.outline).toEqual([{ x: 0, y: 0 }, { x: 620, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }])
    expect(layout.floors[0]!.edges.every(edge => edge.kind === 'wall')).toBe(true)
  })

  it('finds a placed table on its floor in 3D, shows its QR code, and goes back to it on the plan', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page, lab.branchId, '3d')
    await drawn(page)
    const lists = page.getByRole('complementary', { name: 'Navigate the building' })
    await lists.getByRole('button', { name: 'Tables', exact: true }).click()
    await lists.getByTestId('list-table-L1').click()
    const card = page.getByTestId('table-card')
    await expect.poll(() => card.count()).toBe(1)
    await expect.poll(() => card.textContent()).toContain('Ground floor')
    await shot(page, '3d-L1')

    // The table's own QR code: the one the Table list shows.
    const l1 = (await branchTables(page)).find(table => table.label === 'L1')!
    await card.getByRole('button', { name: 'View QR' }).click()
    const dialog = page.getByRole('dialog', { name: 'QR code: L1' })
    expect(await dialog.getByLabel('QR link').inputValue()).toBe(l1.qrUrl)
    await page.keyboard.press('Escape')
    await expect.poll(() => dialog.count()).toBe(0)

    await card.getByRole('button', { name: 'Edit in 2D' }).click()
    await expect.poll(() => page.getByTestId('selected-table').textContent()).toContain('L1')

    // The same table stays picked on the way back, and a change is drawn at once (it saves itself, ISS-027).
    const movedFrom = await positionOf(page, 'L1')
    await plan(page).press('ArrowUp')
    await expect.poll(() => positionOf(page, 'L1')).toEqual({ x: movedFrom.x, y: movedFrom.y - 1 })
    await page.getByRole('button', { name: '3D', exact: true }).first().click()
    await drawn(page)
    await expect.poll(() => page.getByTestId('table-card').textContent()).toContain('L1')
    // Undo from the keyboard works in 3D too (D277), and saves again.
    await page.keyboard.press('ControlOrMeta+z')
    await save(page)
    expect((await savedLayout(page)).placements.find(placement => placement.floorId && placement.x === movedFrom.x && placement.y === movedFrom.y)).toBeTruthy()
  })

  it('on a phone, the lists and QR work before WebGL starts and after graphics are lost inside a floor', { timeout: 120_000 }, async () => {
    // three.js reports the missing context itself before the view shows its message.
    allowBrowserProblems(/THREE\.WebGLRenderer: Error creating WebGL context/, /THREE\.WebGLRenderer: A WebGL context could not be created/)
    const page = await signedIn(390, 844)
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

    const openLists = () => view.getByRole('button', { name: 'Floors and tables' }).click()
    const lists = page.getByRole('dialog', { name: 'Floors and tables' })
    await openLists()
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

    await page.getByTestId('quality').waitFor({ timeout: 45_000 })
    await openLists()
    await lists.getByRole('button', { name: 'Ground floor' }).click()
    await lists.getByRole('button', { name: 'Enter floor' }).click()
    await view.getByRole('button', { name: 'Back to building' }).waitFor()
    await page.getByTestId('building-canvas').evaluate((canvas) => {
      const extension = (canvas as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context')
      if (!extension) throw new Error('The browser cannot simulate WebGL context loss')
      extension.loseContext()
    })
    await view.getByText('3D view is not available here').waitFor()
    await openLists()
    await lists.getByRole('heading', { name: 'Tables', exact: true }).waitFor()
    await lists.getByTestId('list-table-L1').click()
    await card.getByRole('button', { name: 'View QR' }).click()
    await page.getByRole('dialog', { name: 'QR code: L1' }).waitFor()
    await page.keyboard.press('Escape')
    await view.getByRole('button', { name: 'Try again' }).click()
    await drawn(page)
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
    await card.getByRole('button', { name: 'Edit in 2D' }).click()
    await plan(page).getByTestId('plan-table-L1').waitFor()
  })

  it('opens Studio from Dining tables, keeps the selected table and zoom across views, and returns to the table list', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await page.goto(url(`/c/${lab.slug}/admin/branches/${lab.branchId}?tab=tables`), { waitUntil: 'hydration' })
    await page.getByRole('link', { name: 'Open Studio' }).click()
    await page.waitForURL(address => address.pathname.endsWith(`/admin/studio/${lab.branchId}`))
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    const zoom = await plan(page).getAttribute('viewBox')
    await page.getByRole('button', { name: '3D', exact: true }).click()
    await drawn(page)
    await page.getByTestId('table-card').getByRole('button', { name: 'Edit in 2D' }).click()
    expect(await plan(page).getAttribute('viewBox')).toBe(zoom)
    await page.getByTestId('selected-table').getByText('L1', { exact: true }).waitFor()
    // A piece stays selected too, from 3D back to 2D by the toolbar's 2D (ISS-024).
    const piece = plan(page).locator('g[data-kind="item"]').first()
    const pieceId = await piece.getAttribute('data-id')
    await piece.click()
    await page.getByRole('button', { name: '3D', exact: true }).click()
    await drawn(page)
    await page.getByRole('button', { name: '2D', exact: true }).click()
    await plan(page).waitFor()
    await plan(page).locator(`#plan-piece-item-${pieceId}`).waitFor()
    await expect.poll(() => page.getByRole('complementary', { name: 'Properties' }).getByText('no QR code').count()).toBe(1)
    await page.getByRole('button', { name: 'Back to admin' }).click()
    await page.waitForURL(address => address.pathname.endsWith(`/admin/branches/${lab.branchId}`) && address.searchParams.get('tab') === 'tables')
  })

  it('Studio shell (D277): the sidebar hides and resizes without mounting the plan again, and the toolbar and Save layout work in both views', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    // A mark on the plan's element: it is still there only if the plan was never mounted again.
    await plan(page).evaluate(svg => svg.setAttribute('data-kept', 'yes'))
    const width = (await plan(page).boundingBox())!.width
    // Like Figma (ISS-028): hiding or showing the sidebar keeps the zoom, and the plan stays where it is on the screen.
    const zoomLevel = page.getByTestId('zoom-level')
    const zoomBefore = await zoomLevel.textContent()
    const tableAt = async () => {
      const box = (await plan(page).getByTestId('plan-table-L1').boundingBox())!
      return { x: Math.round(box.x), y: Math.round(box.y) }
    }
    const tableBefore = await tableAt()
    const sidebar = page.getByTestId('studio-sidebar')
    await page.getByRole('button', { name: 'Hide sidebar' }).click()
    await sidebar.waitFor({ state: 'detached' })
    await expect.poll(async () => (await plan(page).boundingBox())!.width).toBeGreaterThan(width)
    await expect.poll(tableAt).toEqual(tableBefore)
    expect(await zoomLevel.textContent()).toBe(zoomBefore)
    await shot(page, 'sidebar-hidden')
    await page.getByRole('button', { name: 'Show sidebar' }).click()
    await sidebar.waitFor()
    await expect.poll(tableAt).toEqual(tableBefore)
    expect(await zoomLevel.textContent()).toBe(zoomBefore)
    expect(await plan(page).getAttribute('data-kept')).toBe('yes')
    await page.getByTestId('selected-table').getByText('L1', { exact: true }).waitFor()

    // The sidebar resizes from its handle, also by keyboard; hiding it keeps the width, 3D uses it too.
    const sidebarWidth = () => sidebar.evaluate(element => Math.round(element.getBoundingClientRect().width))
    const initial = await sidebarWidth()
    await page.getByRole('separator', { name: 'Resize sidebar' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(sidebarWidth).toBeGreaterThan(initial)
    const widened = await sidebarWidth()
    await page.getByRole('button', { name: 'Hide sidebar' }).click()
    await sidebar.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Show sidebar' }).click()
    await expect.poll(sidebarWidth).toBe(widened)
    expect(await plan(page).getAttribute('data-kept')).toBe('yes')

    // One toolbar, the same groups in 3D; Save layout stays on the canvas.
    const toolbar = page.getByRole('toolbar', { name: 'Canvas tools' })
    expect(await toolbar.getByRole('group').evaluateAll(groups => groups.map(group => group.getAttribute('aria-label')))).toEqual(['Tools', 'Layout view', 'Zoom', 'History'])
    await toolbar.getByRole('button', { name: '3D', exact: true }).click()
    await drawn(page)
    expect(await toolbar.getByRole('group').evaluateAll(groups => groups.map(group => group.getAttribute('aria-label')))).toEqual(['Layout view', 'Zoom', 'History'])
    await toolbar.getByRole('button', { name: 'Fit building' }).waitFor()
    expect(await page.getByRole('complementary', { name: 'Navigate the building' }).evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(widened)
    await saveButton(page).waitFor()
    await page.getByRole('button', { name: 'Back to admin' }).waitFor()
    await shot(page, 'studio-3d')
    await toolbar.getByRole('button', { name: '2D', exact: true }).click()
    await plan(page).waitFor()
    await shot(page, 'studio-2d')
  })

  it('Studio panels (D277): Find, a new floor named in place, and Manage looks without losing the draft', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await plan(page).press('ArrowRight')
    await page.getByTestId('layout-unsaved').waitFor()

    // Find: the floors and the named pieces on the floor shown.
    await showPanel(page, 'Floors')
    const floorsPanel = page.getByRole('complementary', { name: 'Floors' })
    const find = floorsPanel.getByRole('textbox', { name: 'Find floors and pieces' })
    await floorsPanel.getByRole('button', { name: 'Find' }).click()
    await find.fill('nothing like this')
    await floorsPanel.getByText('No floors or pieces match.').waitFor()
    await floorsPanel.getByRole('button', { name: 'Close Find' }).click()
    await page.getByTestId('floor-tab-Ground').waitFor()
    // Choosing a result selects it and closes Find.
    await floorsPanel.getByRole('button', { name: 'Find' }).click()
    await find.fill('stair')
    await floorsPanel.getByRole('button', { name: 'Stairs' }).click()
    await page.getByRole('complementary', { name: 'Properties' }).getByText('Stairs', { exact: true }).first().waitFor()
    await page.getByTestId('floor-tab-Ground').waitFor()

    // Escape keeps the new floor's default name.
    await floorsPanel.getByRole('button', { name: 'Add floor' }).click()
    const floorName = floorsPanel.getByRole('textbox', { name: 'New floor name' })
    const defaultName = await floorName.inputValue()
    await floorName.press('Escape')
    await page.getByTestId(`floor-tab-${defaultName}`).waitFor()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => page.getByTestId(`floor-tab-${defaultName}`).count()).toBe(0)

    // At the floor limit, Add floor is off and the panel says why.
    const addFloor = floorsPanel.getByRole('button', { name: 'Add floor' })
    let added = 0
    while (await addFloor.isEnabled()) {
      await addFloor.click()
      await floorsPanel.getByRole('textbox', { name: 'New floor name' }).press('Escape')
      added++
    }
    expect(await floorsPanel.getByTestId('floor-limit').textContent()).toContain('at most 10 floors')
    for (let step = 0; step < added; step++) await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => floorsPanel.getByTestId('floor-limit').count()).toBe(0)
    await page.getByTestId('layout-unsaved').waitFor()

    // Manage looks opens inside Studio; the unsaved move is still there.
    await showPanel(page, 'Manage looks')
    const looksPanel = page.getByRole('complementary', { name: 'Manage looks' })
    await looksPanel.getByTestId('looks-tables').waitFor()
    await looksPanel.getByRole('button', { name: 'New look' }).waitFor()
    await shot(page, 'studio-manage-looks')
    await page.getByTestId('layout-unsaved').waitFor()
    expect(new URL(page.url()).pathname).toContain('/admin/studio/')
  })

  it('Properties (D277): typed position and turn commit on Enter, Escape changes nothing, one undo step each', async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    const panel = page.getByRole('complementary', { name: 'Properties' })
    const before = await positionOf(page, 'L1')
    const x = panel.getByLabel('X (cm)', { exact: true })
    const angle = panel.getByLabel('Rotation (°)')
    const turnedBefore = await angle.inputValue()

    await x.fill(String(before.x + 50))
    await x.press('Enter')
    await expect.poll(() => positionOf(page, 'L1')).toEqual({ x: before.x + 50, y: before.y })
    await page.getByTestId('layout-unsaved').waitFor()

    // Escape puts the field back and leaves the table and the selection as they were.
    await x.fill('999')
    await x.press('Escape')
    expect(await x.inputValue()).toBe(String(before.x + 50))
    expect(await positionOf(page, 'L1')).toEqual({ x: before.x + 50, y: before.y })
    await page.getByTestId('selected-table').waitFor()

    // Any angle is kept as 0–359°: a full turn more lands on the same angle.
    const turned = turnedBefore === '90' ? 180 : 90
    await angle.fill(String(turned + 360))
    await angle.press('Enter')
    await expect.poll(() => angle.inputValue()).toBe(String(turned))
    // The same angle typed again as a turn more: the angle shown already, so no undo step.
    await angle.fill(String(turned + 360))
    await angle.press('Enter')
    await expect.poll(() => angle.inputValue()).toBe(String(turned))

    // One undo step for each committed edit, none for the field left with Escape.
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => angle.inputValue()).toBe(turnedBefore)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => positionOf(page, 'L1')).toEqual(before)
    await expect.poll(() => saveButton(page).isDisabled()).toBe(true)
  })

  it('works like Figma (D278): keys without focusing the plan, wheel and zoom keys, tool keys, hover, a piece against a wall', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    const l1 = plan(page).getByTestId('plan-table-L1')
    await l1.waitFor()

    // Hovering shows what a click would pick.
    await l1.hover()
    await plan(page).getByTestId('plan-hover').waitFor()

    // Keys act on the selection after a click elsewhere (a panel button has the focus): 1 cm, Shift 10 cm (Figma's, ISS-004).
    await l1.click()
    const start = await positionOf(page, 'L1')
    await showPanel(page, 'Floors')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => positionOf(page, 'L1')).toEqual({ x: start.x + 1, y: start.y })
    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => positionOf(page, 'L1')).toEqual({ x: start.x + 1, y: start.y + 10 })
    await page.keyboard.press('Shift+R')
    await expect.poll(() => l1.getAttribute('transform')).toMatch(/rotate\((90|180|270|0)\)/)

    // Shift+drag on the selected table (ISS-011): it stays selected and moves straight across.
    const before = await positionOf(page, 'L1')
    await dragPlan(page, before, { x: before.x + 100, y: before.y + 30 }, ['Shift'])
    await expect.poll(async () => (await positionOf(page, 'L1')).x).not.toBe(before.x)
    expect((await positionOf(page, 'L1')).y).toBe(before.y)
    await page.getByTestId('selected-table').getByText('L1', { exact: true }).waitFor()
    // Properties' fields (ISS-020, Figma): math, Shift+arrow 10, out of range kept with a message, letters ignored.
    const xField = page.getByRole('complementary', { name: 'Properties' }).getByLabel('X (cm)', { exact: true })
    const typedFrom = await positionOf(page, 'L1')
    await xField.fill(`${typedFrom.x}+20`)
    await xField.press('Enter')
    await expect.poll(async () => (await positionOf(page, 'L1')).x).toBe(typedFrom.x + 20)
    await xField.press('Shift+ArrowUp')
    await expect.poll(async () => (await positionOf(page, 'L1')).x).toBe(typedFrom.x + 30)
    await xField.fill('abc')
    await xField.press('Enter')
    expect(await xField.inputValue()).toBe(String(typedFrom.x + 30))
    await xField.fill('99999')
    await xField.press('Enter')
    await page.getByText('Kept within limits').first().waitFor()
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => positionOf(page, 'L1')).toEqual(typedFrom)

    // Escape before the release puts it back (ISS-012).
    const held = await positionOf(page, 'L1')
    const from = await onScreen(page, held)
    const away = await onScreen(page, { x: held.x + 150, y: held.y + 100 })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(away.x, away.y, { steps: 6 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await positionOf(page, 'L1')).toEqual(held)
    await page.getByTestId('selected-table').getByText('L1', { exact: true }).waitFor()
    // Shift+click on it without a move takes it out of the selection.
    await l1.click({ modifiers: ['Shift'] })
    await page.getByTestId('selected-table').waitFor({ state: 'detached' })
    await l1.click()

    // The wheel pans and keeps the zoom; Ctrl+wheel zooms; Shift+0 is 100 %, Shift+1 fits.
    const zoom = page.getByTestId('zoom-level')
    const viewBox = () => plan(page).getAttribute('viewBox')
    const box = (await plan(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const zoomBefore = await zoom.textContent()
    const viewBefore = await viewBox()
    await page.mouse.wheel(0, 200)
    await expect.poll(viewBox).not.toBe(viewBefore)
    expect(await zoom.textContent()).toBe(zoomBefore)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await expect.poll(() => zoom.textContent()).not.toBe(zoomBefore)
    await page.keyboard.press('Shift+0')
    await expect.poll(() => zoom.textContent()).toBe('100%')
    await page.keyboard.press('Shift+1')
    await expect.poll(() => zoom.textContent()).not.toBe('100%')
    // Ctrl+0 is 100 % too (ISS-006), without the browser's page zoom.
    await page.keyboard.press('Control+0')
    await expect.poll(() => zoom.textContent()).toBe('100%')
    // A typed percentage in the zoom menu (ISS-003): clamped to 800 %, letters are ignored.
    // Each time from a closed menu: a number closes it (wait until it is gone, it animates out),
    // letters leave it open.
    const zoomField = page.getByTestId('zoom-input')
    const typeZoom = async (text: string, closes: boolean) => {
      await zoom.click()
      await zoomField.fill(text)
      await zoomField.press('Enter')
      if (closes) await zoomField.waitFor({ state: 'detached' })
    }
    await typeZoom('150', true)
    await expect.poll(() => zoom.textContent()).toBe('150%')
    await typeZoom('99999', true)
    await expect.poll(() => zoom.textContent()).toBe('800%')
    await typeZoom('abc', false)
    await expect.poll(() => zoomField.inputValue()).toBe('800')
    expect(await zoom.textContent()).toBe('800%')
    await page.keyboard.press('Escape')
    await zoomField.waitFor({ state: 'detached' })
    await page.keyboard.press('Shift+1')

    // Tab on the plan selects the next piece, Shift+Tab goes back (ISS-007); Escape twice lets Tab leave it.
    await l1.click()
    const selectedNow = () => page.getByRole('complementary', { name: 'Properties' }).textContent()
    const first = await selectedNow()
    await page.keyboard.press('Tab')
    await expect.poll(selectedNow).not.toBe(first)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(selectedNow).toBe(first)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    expect(await plan(page).evaluate(svg => svg.contains(document.activeElement))).toBe(false)

    // Ctrl+/ searches Studio's actions (owner, 2026-11-13): typing finds one, Enter runs it.
    await page.keyboard.press('Control+/')
    const commands = page.getByTestId('studio-commands')
    await commands.waitFor()
    await page.keyboard.type('draw wall')
    // The list filters as it's typed: Enter picks the top match once it is there.
    await expect.poll(() => commands.getByRole('option').first().textContent()).toContain('Draw wall')
    await page.keyboard.press('Enter')
    await expect.poll(() => plan(page).getAttribute('data-mode')).toBe('wall')
    await commands.waitFor({ state: 'detached' })
    await page.keyboard.press('Escape')
    await expect.poll(() => plan(page).getAttribute('data-mode')).toBe('select')

    // ? lists the shortcuts (ISS-025), the new ones included.
    await page.keyboard.press('Shift+Slash')
    const list = page.getByRole('dialog').filter({ hasText: 'Copy the selection' })
    await list.waitFor()
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached' })

    // Tool keys: W opens Draw wall, Escape goes back to Select; V and H switch too.
    await page.keyboard.press('w')
    await page.getByTestId('tool-bar').getByText('Draw wall').waitFor()
    await page.keyboard.press('Escape')
    await page.getByTestId('tool-bar').waitFor({ state: 'detached' })
    await page.keyboard.press('h')
    await expect.poll(() => plan(page).getAttribute('data-mode')).toBe('hand')
    await page.keyboard.press('v')
    await expect.poll(() => plan(page).getAttribute('data-mode')).toBe('select')

    // A plant against the outside wall is picked, not the wall behind it.
    const ground = (await savedLayout(page)).floors.find(floor => floor.id === 'ground')!
    const outline = ground.outline
    const index = outline.findIndex((point, at) => point.x === outline[(at + 1) % outline.length]!.x && point.x === Math.max(...outline.map(corner => corner.x)))
    const wallX = outline[index]!.x
    const wallY = Math.round((outline[index]!.y + outline[(index + 1) % outline.length]!.y) / 2)
    await showPanel(page, 'Assets')
    await page.getByTestId('catalog-plant').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    const panel = page.getByRole('complementary', { name: 'Properties' })
    for (const [label, value] of [['X (cm)', wallX - 15], ['Y (cm)', wallY]] as const) {
      await panel.getByLabel(label, { exact: true }).fill(String(value))
      await panel.getByLabel(label, { exact: true }).press('Enter')
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
    await expect.poll(() => panel.getByLabel('X (cm)', { exact: true }).count()).toBe(0)
    await clickPlan(page, { x: wallX - 15, y: wallY })
    await expect.poll(() => panel.getByLabel('X (cm)', { exact: true }).inputValue()).toBe(String(wallX - 15))
    expect(await plan(page).getByTestId('plan-edge-selected').count()).toBe(0)

    // Dragged near the wall, the plant snaps flush against its inner face (ISS-034): its right edge
    // (25 cm from its centre) on the wall, no gap.
    await dragPlan(page, { x: wallX - 15, y: wallY }, { x: wallX - 29, y: wallY + 40 })
    await expect.poll(() => panel.getByLabel('X (cm)', { exact: true }).inputValue()).toBe(String(wallX - 25))
    // The outline's walls are drawn as mitred bands, one shape per wall edge (clean corners).
    expect(await plan(page).locator('[data-testid^="plan-outline-band-"]').count()).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Undo' }).click()
  })

  it('draws like Figma (D278 PR 2): Room adds and refuses, Edit points drags a side, inside glass with a gap, a named Shape', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    const before = (await savedLayout(page)).floors.find(floor => floor.id === 'ground')!
    const right = Math.max(...before.outline.map(point => point.x))
    const top = Math.min(...before.outline.map(point => point.y))
    const groundOf = async () => (await savedLayout(page)).floors.find(floor => floor.id === 'ground')!
    const mode = () => plan(page).getAttribute('data-mode')

    // Room (R): a rectangle beside the floor merges into it; then Select again.
    await page.keyboard.press('r')
    await expect.poll(mode).toBe('room')
    await dragPlan(page, { x: right - 50, y: top }, { x: right + 200, y: top + 200 })
    await expect.poll(mode).toBe('select')
    await save(page)
    // The new room reaches past the view: Shift+1 fits the floor again.
    await page.keyboard.press('Shift+1')
    let ground = await groundOf()
    expect(Math.max(...ground.outline.map(point => point.x))).toBe(right + 200)
    // A cut inside the floor would leave a hole: refused, and it says why.
    await page.keyboard.press('r')
    // Cut is the tool bar's choice now; Alt draws from the middle (owner: like Figma).
    await page.getByTestId('tool-bar').getByRole('button', { name: 'Cut' }).click()
    await dragPlan(page, { x: right + 50, y: top + 50 }, { x: right + 100, y: top + 150 })
    await page.getByText('That would leave a hole in the floor', { exact: false }).first().waitFor()
    await page.keyboard.press('Escape')
    await expect.poll(mode).toBe('select')

    // Edit points (Enter): the new room's right side dragged 100 cm out, both its corners together.
    await page.keyboard.press('Enter')
    await expect.poll(mode).toBe('outline')
    await dragPlan(page, { x: right + 200, y: top + 50 }, { x: right + 300, y: top + 50 })
    // A double-click on a side adds a corner there (ISS-019); undone again.
    const corners = () => plan(page).locator('[data-kind="corner"]').count()
    const cornersBefore = await corners()
    // Off the side's middle: its round handle there adds a corner on a single click.
    const onSide = await onScreen(page, { x: right + 300, y: top + 40 })
    await page.mouse.dblclick(onSide.x, onSide.y)
    await expect.poll(corners).toBe(cornersBefore + 1)
    await page.keyboard.press('Control+z')
    await expect.poll(corners).toBe(cornersBefore)
    await page.keyboard.press('Escape')
    await expect.poll(mode).toBe('select')
    await save(page)
    ground = await groundOf()
    expect(ground.outline.filter(point => point.x === right + 300)).toHaveLength(2)

    // Draw wall (W) inside the new room, then make it glass with a gap, and drag its end.
    await page.keyboard.press('w')
    await clickPlan(page, { x: right + 25, y: top + 100 })
    await clickPlan(page, { x: right + 225, y: top + 100 })
    await page.keyboard.press('Escape')
    await expect.poll(mode).toBe('select')
    await clickPlan(page, { x: right + 125, y: top + 100 })
    const properties = page.getByRole('complementary', { name: 'Properties' })
    await properties.getByTestId('selected-wall').waitFor()
    await properties.getByRole('group', { name: 'Wall type' }).getByRole('button', { name: 'Glass' }).click()
    await properties.getByRole('button', { name: 'Opening', exact: true }).click()
    await properties.getByTestId('wall-opening-door').waitFor()
    expect(await properties.getByRole('button', { name: 'Window' }).count()).toBe(0)
    await shot(page, 'inside-glass')
    const end = (await plan(page).getByTestId('wall-end-to').boundingBox())!
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2)
    await page.mouse.down()
    const target = await onScreen(page, { x: right + 275, y: top + 100 })
    await page.mouse.move(target.x, target.y, { steps: 6 })
    await page.mouse.up()

    // Shape (S): a block drawn on the floor (over whatever is there), named Stage and 40 cm high.
    await page.keyboard.press('s')
    await expect.poll(mode).toBe('shape')
    // While drawing, the size shows under the shape (ISS-029).
    const shapeStart = await onScreen(page, { x: right - 400, y: top + 400 })
    const shapeEnd = await onScreen(page, { x: right - 200, y: top + 500 })
    await page.mouse.move(shapeStart.x, shapeStart.y)
    await page.mouse.down()
    await page.mouse.move(shapeEnd.x, shapeEnd.y, { steps: 8 })
    await expect.poll(() => plan(page).getByTestId('draw-size').textContent()).toBe('200 × 100 cm')
    await page.mouse.up()
    await expect.poll(mode).toBe('select')
    const name = properties.getByLabel('Name')
    await name.fill('Stage')
    await name.press('Enter')
    await properties.getByLabel('Height (cm)').fill('40')
    await properties.getByLabel('Height (cm)').press('Enter')
    await plan(page).getByText('Stage').waitFor()
    // A click with Shape (ISS-016, like Figma's): a 100 × 100 cm block there, selected; Undo takes it away.
    await page.keyboard.press('s')
    await expect.poll(mode).toBe('shape')
    await clickPlan(page, { x: right - 600, y: top + 450 })
    await expect.poll(mode).toBe('select')
    await expect.poll(() => properties.getByLabel('Width (cm)').inputValue()).toBe('100')
    expect(await properties.getByLabel('Depth (cm)').inputValue()).toBe('100')
    await page.getByRole('button', { name: 'Undo' }).click()
    await shot(page, 'shape-stage')

    await save(page)
    ground = await groundOf()
    const glass = ground.walls.find(wall => wall.kind === 'glass')!
    expect(glass).toMatchObject({ from: { x: right + 25, y: top + 100 }, to: { x: right + 275, y: top + 100 } })
    expect(glass.openings).toHaveLength(1)
    expect(ground.items.find(item => item.kind === 'block')).toMatchObject({ name: 'Stage', height: 40, width: 200, depth: 100 })
  })

  it('selects several together (D278): Ctrl/⌘+A, Shift+click, a box, arrows and Delete as one undo step, Alt distances', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    const l1 = plan(page).getByTestId('plan-table-L1')
    await l1.waitFor()
    const properties = page.getByRole('complementary', { name: 'Properties' })
    const group = properties.getByTestId('selected-group')

    // Ctrl/⌘+A: everything on the floor; Escape clears it.
    await page.keyboard.press('ControlOrMeta+a')
    await group.waitFor()
    await plan(page).getByTestId('plan-group').waitFor()
    await shot(page, 'group-all')
    await page.keyboard.press('Escape')
    await group.waitFor({ state: 'detached' })

    // A plant placed beside L1, then Shift+click both: they move together, one undo step.
    await showPanel(page, 'Assets')
    await page.getByTestId('catalog-plant').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    const plants = plan(page).getByTestId('plan-item-plant')
    const plant = plants.last()
    const plantAt = async () => {
      const transform = await plant.getAttribute('transform')
      const [, x, y] = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform ?? '') ?? []
      return { x: Number(x), y: Number(y) }
    }
    const tableBefore = await positionOf(page, 'L1')
    // Put the plant clear of L1, 150 cm to its right.
    for (const [label, value] of [['X (cm)', tableBefore.x + 150], ['Y (cm)', tableBefore.y]] as const) {
      await properties.getByLabel(label, { exact: true }).fill(String(value))
      await properties.getByLabel(label, { exact: true }).press('Enter')
    }
    await expect.poll(plantAt).toEqual({ x: tableBefore.x + 150, y: tableBefore.y })
    const plantBefore = await plantAt()
    await l1.click()
    await plant.click({ modifiers: ['Shift'] })
    await expect.poll(() => group.textContent()).toContain('2 selected')
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => positionOf(page, 'L1')).toEqual({ x: tableBefore.x + 10, y: tableBefore.y })
    expect(await plantAt()).toEqual({ x: plantBefore.x + 10, y: plantBefore.y })
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => positionOf(page, 'L1')).toEqual(tableBefore)
    expect(await plantAt()).toEqual(plantBefore)

    // Shift+drag on a piece not yet selected (ISS-011, Figma): it joins, and the set moves together.
    await page.keyboard.press('Escape')
    await l1.click()
    const plantStart = await plantAt()
    await dragPlan(page, plantStart, { x: plantStart.x + 100, y: plantStart.y + 3 }, ['Shift'])
    await expect.poll(() => group.textContent()).toContain('2 selected')
    await expect.poll(async () => (await plantAt()).x).not.toBe(plantStart.x)
    const moved = (await plantAt()).x - plantStart.x
    expect((await positionOf(page, 'L1')).x - tableBefore.x).toBe(moved)
    expect((await plantAt()).y).toBe(plantStart.y)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => positionOf(page, 'L1')).toEqual(tableBefore)

    // Align (ISS-026): the tops line up (the plant, smaller than L1 and its chairs, moves up), one undo step.
    await page.getByTestId('align-top').click()
    await expect.poll(async () => (await plantAt()).y).toBeLessThan(plantBefore.y)
    expect(await positionOf(page, 'L1')).toEqual(tableBefore)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => positionOf(page, 'L1')).toEqual(tableBefore)
    expect(await plantAt()).toEqual(plantBefore)

    // Delete on the set: L1 back to Unplaced tables, the plant gone; Undo brings both back.
    const plantCount = await plants.count()
    await page.keyboard.press('Delete')
    await expect.poll(() => plants.count()).toBe(plantCount - 1)
    expect(await l1.count()).toBe(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await l1.waitFor()
    await expect.poll(() => plants.count()).toBe(plantCount)

    // A box dragged on empty plan around L1 picks it (and only what the box touches).
    await page.keyboard.press('Escape')
    const box = (await l1.boundingBox())!
    // Start from an empty corner beside L1 (not a piece, a wall or an edge) and drag to the opposite one.
    const corners = [-1, 1].flatMap(sx => [-1, 1].map(sy => ({ sx, sy })))
    const empty = await page.evaluate(([bounds, candidates]) => {
      for (const reach of [12, 24, 36]) {
        for (const { sx, sy } of candidates) {
          const point = { x: bounds.x + bounds.width / 2 + sx * (bounds.width / 2 + reach), y: bounds.y + bounds.height / 2 + sy * (bounds.height / 2 + reach) }
          const element = document.elementFromPoint(point.x, point.y)
          if (element?.closest('[data-testid="floor-plan"]') && !element.closest('[data-kind]')) return { point, sx, sy }
        }
      }
      return null
    }, [box, corners] as const)
    expect(empty).not.toBeNull()
    const { point: start, sx, sy } = empty!
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - sx * (box.width / 2 + 6), box.y + box.height / 2 - sy * (box.height / 2 + 6), { steps: 6 })
    await plan(page).getByTestId('plan-marquee').waitFor()
    await page.mouse.up()
    // L1 alone, or with a piece the box also touched (pieces placed by earlier tests sit nearby).
    await expect.poll(() => properties.textContent()).toMatch(/L1|\d selected\s*1 table/)

    // Alt with L1 selected, pointing at the plant: the gap between them is measured.
    await l1.click()
    await plant.hover()
    await page.keyboard.down('Alt')
    await plan(page).getByTestId('plan-gap').first().waitFor()
    await shot(page, 'alt-distances')
    await page.keyboard.up('Alt')
    await expect.poll(() => plan(page).getByTestId('plan-gap').count()).toBe(0)

    // Alt during a drag (ISS-014): the original stays and a copy follows the pointer; letting go of
    // Alt moves it again; Alt held at the release leaves a copy, one undo step.
    const count = await plants.count()
    // By id: the copy is drawn after it, so `last()` would become the copy.
    const original = plan(page).locator(`#plan-piece-item-${await plant.getAttribute('data-id')}`)
    const originalAt = () => original.getAttribute('transform')
    const originalRest = await originalAt()
    const plantBox = (await original.boundingBox())!
    await page.mouse.move(plantBox.x + plantBox.width / 2, plantBox.y + plantBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(plantBox.x + plantBox.width / 2 + 80, plantBox.y + plantBox.height / 2 + 40, { steps: 6 })
    await expect.poll(originalAt).not.toBe(originalRest)
    await page.keyboard.down('Alt')
    await plan(page).getByTestId('copy-preview').waitFor()
    await expect.poll(originalAt).toBe(originalRest)
    await page.keyboard.up('Alt')
    await plan(page).getByTestId('copy-preview').waitFor({ state: 'detached' })
    await page.keyboard.down('Alt')
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect.poll(() => plants.count()).toBe(count + 1)
    expect(await originalAt()).toBe(originalRest)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => plants.count()).toBe(count)

    // Ctrl+C, then Ctrl+V twice (ISS-022): two copies, each one undo step.
    await original.click()
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Control+v')
    await expect.poll(() => plants.count()).toBe(count + 1)
    await page.keyboard.press('Control+v')
    await expect.poll(() => plants.count()).toBe(count + 2)
    await page.getByRole('button', { name: 'Undo' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => plants.count()).toBe(count)

    // Layers (ISS-021, Figma): pointing at a row outlines it on the plan; the eye hides it from the
    // plan; the lock stops picks on the plan while Layers still selects it; a double-click renames;
    // Shift+click selects the range.
    await page.keyboard.press('Escape')
    await showPanel(page, 'Floors')
    const plantId = (await original.getAttribute('id'))!.replace('plan-piece-item-', '')
    const plantRow = page.getByTestId(`layer-item-${plantId}-row`)
    await plantRow.hover()
    await plan(page).getByTestId('plan-hover').waitFor()
    await plantRow.getByTestId('layer-eye').click()
    await expect.poll(() => original.count()).toBe(0)
    await plantRow.getByTestId('layer-eye').click()
    await expect.poll(() => original.count()).toBe(1)
    const l1Row = page.getByTestId('layer-table-L1-row')
    await l1Row.hover()
    await l1Row.getByTestId('layer-lock').click()
    await expect.poll(() => l1.getAttribute('pointer-events')).toBe('none')
    await page.getByTestId('layer-table-L1').click()
    await page.getByTestId('selected-table').getByText('L1', { exact: true }).waitFor()
    await l1Row.getByTestId('layer-lock').click()
    await expect.poll(() => l1.getAttribute('pointer-events')).toBeNull()
    await page.getByTestId(`layer-item-${plantId}`).dblclick()
    const nameField = plantRow.getByRole('textbox')
    await nameField.fill('Fern')
    await nameField.press('Enter')
    await expect.poll(() => plantRow.textContent()).toContain('Fern')
    await page.getByTestId('layer-table-L1').click()
    await page.getByTestId(`layer-item-${plantId}`).click({ modifiers: ['Shift'] })
    await expect.poll(() => group.textContent()).toMatch(/\d+ selected/)
  })

  it('works on a phone: tables in a bottom sheet, no sideways scrolling', async () => {
    const page = await signedIn(390, 844)
    await openDesign(page)
    await plan(page).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    // A selected table's quick actions fit beside it, as icons.
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByTestId('quick-actions').getByRole('button', { name: 'Duplicate look' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await shot(page, 'phone-quick-actions')
    // Properties has its own button on a phone (D277): typed position, no move pad.
    await page.getByRole('button', { name: 'Properties' }).click()
    await page.getByRole('dialog', { name: 'Properties' }).getByRole('group', { name: 'Position and rotation' }).waitFor()
    await shot(page, 'phone-properties')
    await page.getByRole('dialog', { name: 'Properties' }).getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await plan(page).press('Escape')
    await showPanel(page, 'Tables')
    await page.getByRole('dialog').getByText('Unplaced tables').waitFor()
    await shot(page, 'phone-library')
  })

  it('custom looks: a new look from the library goes on a table, is edited, and deletes once no table uses it', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    await showPanel(page, 'Assets')
    const library = page.getByRole('complementary', { name: 'Assets' })
    const form = () => page.getByRole('dialog', { name: /look$/i })

    // New look: a name is required; a rectangle on four legs in walnut.
    await newTableLook(library)
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
    await newTableLook(library)
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
    await showPanel(page, 'Assets')
    const library = page.getByRole('complementary', { name: 'Assets' })
    const form = () => page.getByRole('dialog', { name: /look$/i })
    const looks = () => page.evaluate(path => fetch(path).then(response => response.json()), `/api/c/${lab.slug}/admin/furniture-looks`) as Promise<CustomLook[]>

    // New look with a photo: framed 4:3 in the crop dialog, uploaded before the look is saved.
    await newTableLook(library)
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
    await page.getByRole('button', { name: '3D', exact: true }).first().click()
    await page.getByTestId('table-card').getByRole('img', { name: 'Photo of Corner sofa' }).waitFor()

    // Save as new look starts from its shape, never its photo: an upload is one look's only.
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').click()
    await page.getByRole('button', { name: 'Save as new look' }).click()
    await form().getByRole('button', { name: 'Upload photo' }).waitFor()
    await form().getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(() => form().count()).toBe(0)

    // Removed in the form: the picker shows the shape again.
    await showPanel(page, 'Assets')
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

  it('the right-click menu (D278): a corner handle resizes, Rotate 90°, Duplicate look asks which table, Remove from map', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    const panel = page.getByRole('complementary', { name: 'Properties' })
    const l1 = plan(page).getByTestId('plan-table-L1')
    await l1.click()
    // A mouse on a wide screen gets no quick bar over the plan: Properties and the menu instead.
    await panel.getByLabel('Width (cm)').waitFor()
    expect(await page.getByTestId('quick-actions').count()).toBe(0)
    // Earlier tests' turns are kept now that the layout saves itself (ISS-027): start from 0°.
    if (!(await l1.getAttribute('transform'))?.includes('rotate(0)')) {
      await panel.getByLabel('Rotation (°)').fill('0')
      await panel.getByLabel('Rotation (°)').press('Enter')
    }
    await expect.poll(() => l1.getAttribute('transform')).toContain('rotate(0)')
    const width = () => panel.getByLabel('Width (cm)').inputValue()
    const before = Number(await width())

    // L1 has a round look: its bottom-right handle, dragged 40 cm out, grows it both ways in one undo step.
    const handle = (await plan(page).getByTestId('resize-handle-2').boundingBox())!
    const scale = await plan(page).evaluate(svg => (svg as SVGSVGElement).getScreenCTM()!.a)
    const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 40 * scale, start.y + 40 * scale, { steps: 5 })
    // The size beside the pointer while resizing (ISS-029).
    await expect.poll(() => plan(page).getByTestId('live-label').textContent()).toBe(`${before + 40} × ${before + 40} cm`)
    await page.mouse.up()
    await expect.poll(width).toBe(String(before + 40))
    expect(await panel.getByLabel('Depth (cm)').inputValue()).toBe(String(before + 40))
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(width).toBe(String(before))
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(width).toBe(String(before + 40))

    // No turn handle above the table (ISS-033): a drag just outside a corner turns it, with the angle beside the pointer.
    expect(await plan(page).getByTestId('rotate-handle').count()).toBe(0)
    const table = (await l1.boundingBox())!
    const center = { x: table.x + table.width / 2, y: table.y + table.height / 2 }
    const zone = (await plan(page).getByTestId('rotate-zone-1').boundingBox())!
    const from = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }
    // A quarter turn clockwise around the centre (y points down).
    const to = { x: center.x - (from.y - center.y), y: center.y + (from.x - center.x) }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2 + (to.x - center.x) / 2, (from.y + to.y) / 2 + (to.y - center.y) / 2, { steps: 4 })
    // Free by default (ISS-013): a few pixels past the quarter turn give an odd angle; Shift snaps to 15°.
    await page.mouse.move(to.x - 6, to.y, { steps: 4 })
    await expect.poll(async () => Number((await plan(page).getByTestId('live-label').textContent())?.replace('°', ''))).not.toBe(90)
    await page.keyboard.down('Shift')
    await page.mouse.move(to.x, to.y, { steps: 2 })
    await expect.poll(() => plan(page).getByTestId('live-label').textContent()).toBe('90°')
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect.poll(() => l1.getAttribute('transform')).toContain('rotate(90)')
    expect(await plan(page).getByTestId('live-label').count()).toBe(0)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => l1.getAttribute('transform')).toContain('rotate(0)')

    await fromMenu(l1, 'Rotate 90°')
    await expect.poll(() => l1.getAttribute('transform')).toContain('rotate(90)')

    // Duplicate look: which table? A new one, saved at once, goes beside L1 with L1's look, size and turn.
    await fromMenu(l1, 'Duplicate look')
    await page.getByRole('dialog').filter({ hasText: 'Which table is this?' }).getByRole('button', { name: 'New table' }).click()
    const form = page.getByRole('dialog', { name: 'New table' })
    await form.getByLabel('Name').fill('L4')
    await form.getByRole('button', { name: 'Add table' }).click()
    await plan(page).getByTestId('plan-table-L4').waitFor()
    await expect.poll(() => page.getByTestId('selected-table').textContent()).toContain('L4')
    await save(page)
    const ids = Object.fromEntries((await branchTables(page)).map(table => [table.label, table.id]))
    const saved = await savedLayout(page)
    const original = saved.placements.find(placement => placement.tableId === ids.L1)!
    const copy = saved.placements.find(placement => placement.tableId === ids.L4)!
    expect(original).toMatchObject({ width: before + 40, depth: before + 40, rotation: 90 })
    expect(copy).toMatchObject({ floorId: original.floorId, lookId: original.lookId, width: original.width, depth: original.depth, rotation: 90, y: original.y })
    expect(copy.x).toBeGreaterThan(original.x)

    // Remove from map: L4 goes back to Unplaced tables.
    await fromMenu(plan(page).getByTestId('plan-table-L4'), 'Remove from map')
    await showPanel(page, 'Tables')
    await unplaced(page, 'L4').waitFor()

    // Furniture: Duplicate copies it beside itself.
    const plants = await plan(page).getByTestId('plan-item-plant').count()
    await showPanel(page, 'Assets')
    await page.getByTestId('catalog-plant').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    // Ctrl/⌘+D duplicates the selection, without focusing the plan first (D278).
    await page.keyboard.press('ControlOrMeta+d')
    await expect.poll(() => plan(page).getByTestId('plan-item-plant').count()).toBe(plants + 2)
    await save(page)
    const items = (await savedLayout(page)).floors.find(floor => floor.id === original.floorId)!.items.filter(item => item.kind === 'plant')
    expect(items).toHaveLength(plants + 2)
    expect((await savedLayout(page)).placements.map(placement => placement.tableId)).not.toContain(ids.L4)
  })

  it('chair and fixture looks (step 3d): made on the Looks page, placed from the library, shared, and deleted once no piece uses it', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    const itemLooks = () => page.evaluate(path => fetch(path).then(response => response.json()), `/api/c/${lab.slug}/admin/item-looks`) as Promise<CustomItemLook[]>
    const form = () => page.getByRole('dialog', { name: /look$/i })
    const looksPage = () => page.goto(url(`/c/${lab.slug}/admin/branches/looks`), { waitUntil: 'hydration' })

    // The Looks page: every built-in look and piece with its picture, under its section.
    await looksPage()
    const tables = page.getByTestId('looks-tables')
    const chairs = page.getByTestId('looks-chairs')
    await tables.getByTestId('look-card-round-cafe').waitFor()
    const pictureLoaded = (card: string) => page.getByTestId(card).locator('img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 480)
    await expect.poll(() => pictureLoaded('look-card-round-cafe')).toBe(true)
    await expect.poll(() => pictureLoaded('look-card-bar-stool')).toBe(true)
    expect(await page.getByTestId('looks-fixtures').getByTestId('look-card-service-counter').isVisible()).toBe(true)
    await shot(page, 'looks-page')

    // A new chair look: a bar stool with a brass frame.
    await chairs.getByRole('button', { name: 'New chair look' }).click()
    await form().getByLabel('Name').fill('Rattan stool')
    await form().getByRole('combobox', { name: 'Kind' }).click()
    await page.getByRole('option', { name: 'Bar stool' }).click()
    await form().getByRole('group', { name: 'Frame' }).getByRole('button', { name: 'Brass' }).click()
    // A counter stool (step 3e): the height a new piece of this look starts with.
    await form().getByLabel('Height (cm)').fill('65')
    await form().getByRole('button', { name: 'Save look' }).click()
    await page.getByText('Look "Rattan stool" saved').first().waitFor()
    await chairs.getByTestId('look-card-Rattan stool').getByText('Not used').waitFor()
    const [stool] = await itemLooks()
    expect(stool).toMatchObject({ name: 'Rattan stool', kind: 'bar-stool', finishes: { frame: 'brass' }, defaultWidth: 40, defaultDepth: 40, defaultHeight: 65, pieces: 0 })

    // In Design shop it waits under Extra seating; placed, its panel names the look, not finishes.
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    await showPanel(page, 'Assets')
    const library = page.getByRole('complementary', { name: 'Assets' })
    await library.getByTestId('item-look-Rattan stool').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    const panel = page.getByRole('complementary', { name: 'Properties' })
    await expect.poll(() => panel.getByRole('combobox', { name: 'Look' }).textContent()).toContain('Rattan stool')
    // Its finishes are the look's: no swatches (a built-in stool shows Frame and Upholstery).
    await panel.getByTestId('selected-item-photo').waitFor()
    expect(await panel.getByRole('group', { name: 'Frame' }).count()).toBe(0)
    expect(await panel.getByRole('group', { name: 'Upholstery' }).count()).toBe(0)
    await save(page)
    const placed = (await savedLayout(page)).floors.flatMap(floor => floor.items).filter(item => item.lookId === stool!.id)
    expect(placed).toMatchObject([{ kind: 'bar-stool', width: 40, depth: 40, height: 65 }])
    expect((await itemLooks())[0]).toMatchObject({ pieces: 1 })

    // Editing it says who uses it and can't delete it; the rename shows in the library.
    await panel.getByRole('button', { name: 'Edit look' }).click()
    await form().getByTestId('item-look-used').getByText('Used by 1 piece').waitFor()
    expect(await form().getByRole('combobox', { name: 'Kind' }).isDisabled()).toBe(true)
    expect(await form().getByRole('button', { name: 'Delete' }).isDisabled()).toBe(true)
    await form().getByLabel('Name').fill('Brass stool')
    await form().getByRole('button', { name: 'Save', exact: true }).click()
    await library.getByTestId('item-look-Brass stool').waitFor()

    // Back on its own finishes (the look's, kept) and saved, the look is free again.
    await panel.getByRole('combobox', { name: 'Look' }).click()
    await page.getByRole('option', { name: 'Own finishes' }).click()
    await panel.getByRole('group', { name: 'Upholstery' }).waitFor()
    await save(page)
    const own = (await savedLayout(page)).floors.flatMap(floor => floor.items).find(item => item.id === placed[0]!.id)
    expect(own).toMatchObject({ kind: 'bar-stool', finishes: { frame: 'brass' } })
    expect(own?.lookId).toBeUndefined()

    // On the Looks page it deletes after a confirmation.
    await looksPage()
    await chairs.getByTestId('look-card-Brass stool').getByText('Not used').waitFor()
    await chairs.getByRole('button', { name: 'Actions for Brass stool' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: 'Delete the look "Brass stool"?' }).getByRole('button', { name: 'Delete look' }).click()
    await page.getByText('Look "Brass stool" deleted').first().waitFor()
    await expect.poll(() => chairs.getByTestId('look-card-Brass stool').count()).toBe(0)
    expect(await itemLooks()).toEqual([])
  })

  it('built-in looks show their pictures in the library and the table\'s panel', async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    await showPanel(page, 'Assets')
    const library = page.getByRole('complementary', { name: 'Assets' })
    const loaded = (image: ReturnType<Page['locator']>) => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)
    await expect.poll(() => loaded(library.getByTestId('look-round-cafe').getByTestId('look-photo'))).toBe(true)
    await library.getByTestId('catalog-plant').scrollIntoViewIfNeeded()
    await expect.poll(() => loaded(library.getByTestId('catalog-plant').locator('img'))).toBe(true)
    await plan(page).getByTestId('plan-table-L1').click()
    await expect.poll(() => page.getByTestId('selected-look-photo').getAttribute('src')).toMatch(/^\/shop-designer\/looks\/[a-z-]+\.webp$/)
  })

  it('the Looks page on a phone: two cards a row, New look in reach, no sideways scrolling', async () => {
    const page = await signedIn(390, 844)
    await page.goto(url(`/c/${lab.slug}/admin/branches/looks`), { waitUntil: 'hydration' })
    await page.getByTestId('look-card-round-cafe').waitFor()
    const [first, second] = await Promise.all(['look-card-round-cafe', 'look-card-square-bistro'].map(card => page.getByTestId(card).boundingBox()))
    expect(second!.y).toBeCloseTo(first!.y, 0)
    expect(await page.getByRole('button', { name: 'New look' }).isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await shot(page, 'phone-looks-page')
  })

  it('types a length on the plan\'s label; Delete removes an inside wall, and an edge has its menu (D278)', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    const ground = (await savedLayout(page)).floors.find(floor => floor.id === 'ground')!
    const right = Math.max(...ground.outline.map(point => point.x))
    const top = Math.min(...ground.outline.map(point => point.y))

    // An inside wall goes with Delete (drawn just outside the building, where nothing covers it).
    const walls = () => plan(page).locator('[data-testid^="plan-wall-"]').count()
    const before = await walls()
    await drawWith(page, 'Draw wall')
    await clickPlan(page, { x: right + 80, y: top })
    await clickPlan(page, { x: right + 80, y: top + 200 })
    // Escape ends the chain and leaves Draw wall (ISS-018).
    await page.keyboard.press('Escape')
    await page.getByTestId('tool-bar').waitFor({ state: 'detached' })
    await expect.poll(walls).toBe(before + 1)
    await clickPlan(page, { x: right + 80, y: top + 100 })
    await page.keyboard.press('Delete')
    await expect.poll(walls).toBe(before)

    // Edit points (3A, D278): a click on a length label makes it a field; Escape leaves it, Enter sets it.
    await drawWith(page, 'Edit points')
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

    // An edge's menu: its type and a gate, a quarter of the way along it.
    const edge = await plan(page).getByTestId('plan-edge-2').evaluate(line => ['x1', 'y1', 'x2', 'y2'].map(name => Number(line.getAttribute(name))))
    const quarter = { x: edge[0]! + (edge[2]! - edge[0]!) / 4, y: edge[1]! + (edge[3]! - edge[1]!) / 4 }
    const rightClickEdge = async () => {
      const at = await plan(page).evaluate((svg, target) => {
        const screen = new DOMPoint(target.x, target.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!)
        return { x: screen.x, y: screen.y }
      }, quarter)
      await page.mouse.click(at.x, at.y, { button: 'right' })
      return page.getByRole('menu')
    }
    const properties = page.getByRole('complementary', { name: 'Properties' })
    let menu = await rightClickEdge()
    await menu.getByRole('menuitemcheckbox', { name: 'Railing' }).click()
    await expect.poll(() => properties.getByRole('button', { name: 'Railing', exact: true }).getAttribute('aria-pressed')).toBe('true')
    menu = await rightClickEdge()
    await menu.getByRole('menuitem', { name: 'Remove railing' }).waitFor()
    expect(await menu.getByRole('menuitem', { name: 'Add a window' }).count()).toBe(0)
    const gates = () => properties.getByTestId('opening-door').count()
    const gatesBefore = await gates()
    await shot(page, 'edge-menu')
    await menu.getByRole('menuitem', { name: 'Add a gate' }).click()
    await expect.poll(gates).toBe(gatesBefore + 1)

    // Delete on an edge makes it Open (its gate goes with it); Undo puts the railing back.
    await page.keyboard.press('Delete')
    await expect.poll(() => properties.getByRole('button', { name: 'Open', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(gates).toBe(gatesBefore + 1)

    await save(page)
    const saved = (await savedLayout(page)).floors.find(floor => floor.id === 'ground')!
    expect(Math.round(Math.hypot(saved.outline[2]!.x - saved.outline[1]!.x, saved.outline[2]!.y - saved.outline[1]!.y))).toBe(length + 100)
    expect(saved.edges[2]!.kind).toBe('railing')
    expect(saved.edges[2]!.openings.filter(opening => opening.kind === 'door')).toHaveLength(gatesBefore + 1)
    expect(saved.walls).toHaveLength(ground.walls.length)
  })

  it('people and pets (step 3g): placed from the library at their own size, saved, and shown in 3D with the viewer\'s own playback', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).waitFor()
    await showPanel(page, 'Assets')
    const library = page.getByTestId('catalog-cat').locator('xpath=ancestor::section[1]')
    expect((await library.getByRole('heading').textContent())?.trim()).toBe('People and pets')
    await page.getByTestId('catalog-cat').scrollIntoViewIfNeeded()
    await expect.poll(() => page.getByTestId('catalog-cat').locator('img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    const cats = await plan(page).getByTestId('plan-item-cat').count()
    await page.getByTestId('catalog-cat').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    await expect.poll(() => plan(page).getByTestId('plan-item-cat').count()).toBe(cats + 1)
    // A figure keeps its size: no width or depth to type, no corner handles; it can still turn.
    const panel = page.getByRole('complementary', { name: 'Properties' })
    await panel.getByText('Decoration · no QR code').waitFor()
    expect(await panel.getByLabel('Width (cm)').count()).toBe(0)
    expect(await panel.getByLabel('Rotation (°)').count()).toBe(1)
    await page.getByTestId('catalog-seated-person').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    await save(page)
    const items = (await savedLayout(page)).floors.flatMap(floor => floor.items)
    expect(items.filter(item => item.kind === 'cat').at(-1)).toMatchObject({ ...FIGURE_SIZES.cat, finishes: {} })
    expect(items.filter(item => item.kind === 'seated-person').at(-1)).toMatchObject(FIGURE_SIZES['seated-person'])

    await page.getByRole('button', { name: '3D', exact: true }).first().click()
    await drawn(page)
    await shot(page, '3d-people-and-pets')
    // In the Scene panel while the scenes flag is on (step 4a), as on this server; a popover without it.
    await page.getByTestId('scene-button').click()
    const show = page.getByRole('switch', { name: 'Show people and pets' })
    const animate = page.getByRole('switch', { name: 'Animate' })
    await show.waitFor()
    expect(await show.getAttribute('aria-checked')).toBe('true')
    // The e2e browser draws with a software renderer, measured slow: Animate starts off there.
    await expect.poll(() => animate.getAttribute('aria-checked')).toBe('false')
    await animate.click()
    expect(await animate.getAttribute('aria-checked')).toBe('true')
    await show.click()
    expect(await show.getAttribute('aria-checked')).toBe('false')
    expect(await animate.isDisabled()).toBe(true)
    // Playback is this viewer's own: nothing to save.
    expect(await saveButton(page).isDisabled()).toBe(true)
  })

  it('a piece\'s own height (step 3e): typed in its panel, saved, and its card in 3D goes back to it on the plan', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).waitFor()
    const stools = await plan(page).getByTestId('plan-item-bar-stool').count()
    await showPanel(page, 'Assets')
    await page.getByTestId('catalog-bar-stool').click()
    await page.getByRole('button', { name: 'Place at center' }).click()
    await expect.poll(() => plan(page).getByTestId('plan-item-bar-stool').count()).toBe(stools + 1)
    const panel = page.getByRole('complementary', { name: 'Properties' })
    const height = panel.getByLabel('Height (cm)')
    // A built-in stool is bar height until changed; a counter stool is 65 cm.
    expect(await height.inputValue()).toBe('75')
    await panel.getByText('45 to 90 cm').waitFor()
    await height.fill('65')
    await height.press('Enter')
    await save(page)
    const stool = (await savedLayout(page)).floors.flatMap(floor => floor.items).filter(item => item.kind === 'bar-stool').at(-1)!
    expect(stool.height).toBe(65)

    // Still selected in View in 3D: its card names it, its height and floor.
    await page.getByRole('button', { name: '3D', exact: true }).first().click()
    await drawn(page)
    const card = page.getByTestId('piece-card')
    await expect.poll(() => card.textContent()).toContain('Bar stool')
    expect(await card.textContent()).toContain('65 cm high')
    await shot(page, '3d-piece-card')
    await card.getByRole('button', { name: 'Edit in 2D' }).click()
    await plan(page).waitFor()
    await expect.poll(() => panel.getByLabel('Height (cm)').inputValue()).toBe('65')
    // Taken off again: the layout as the next test expects it.
    await panel.getByRole('button', { name: 'Delete' }).click()
    await save(page)
  })

  it('more furniture (step 3f): four new library sections, placed, saved, in 3D, and on the Looks page', { timeout: 90_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).waitFor()
    const before = await savedLayout(page)
    await showPanel(page, 'Assets')
    const library = page.getByRole('complementary', { name: 'Assets' })
    for (const heading of ['Lounge seating', 'Bar and service', 'Decor and lighting', 'Outdoor']) {
      await library.getByRole('heading', { name: heading }).waitFor()
    }
    // One create menu beside the search (D277) offers every kind of look.
    await library.getByRole('button', { name: 'New look' }).click()
    await page.getByRole('menuitem', { name: 'New lounge look' }).waitFor()
    await page.keyboard.press('Escape')
    const kinds = ['armchair', 'coffee-station', 'pendant-lamp', 'parasol'] as const
    for (const kind of kinds) {
      await page.getByTestId(`catalog-${kind}`).scrollIntoViewIfNeeded()
      await page.getByTestId(`catalog-${kind}`).click()
      await page.getByRole('button', { name: 'Place at center' }).click()
      await plan(page).getByTestId(`plan-item-${kind}`).first().waitFor()
    }
    // A parasol's height is its own, in its range.
    const panel = page.getByRole('complementary', { name: 'Properties' })
    await panel.getByText('200 to 280 cm').waitFor()
    await save(page)
    const saved = (await savedLayout(page)).floors.flatMap(floor => floor.items).map(item => item.kind)
    for (const kind of kinds) expect(saved).toContain(kind)

    await page.getByRole('button', { name: '3D', exact: true }).first().click()
    await drawn(page)
    await shot(page, '3d-more-furniture')

    await page.goto(url(`/c/${lab.slug}/admin/branches/looks`), { waitUntil: 'hydration' })
    const lounge = page.getByTestId('looks-lounge')
    await lounge.getByTestId('look-card-sofa').waitFor()
    await page.getByTestId('looks-outdoor').getByTestId('look-card-bicycle').waitFor()

    // The layout as it was, for the next test.
    const { floors, placements } = before
    expect(await saveElsewhere(page, { version: (await savedLayout(page)).version, layout: { floors, placements } })).toBe(200)
  })

  it('the scene (step 4a, flag on): the lane chosen in the Scene panel, tables still found, saved with the layout and seen by another device; playback stays on each device', { timeout: 120_000 }, async () => {
    const page = await signedIn()
    await page.goto(url(`${branchPath(lab.branchId, '3d')}&bench=orbit`), { waitUntil: 'hydration' })
    await drawn(page)
    expect((await savedLayout(page)).scene).toEqual({ preset: 'none' })
    await page.getByTestId('scene-button').click()
    const panel = page.getByRole('complementary', { name: 'Scene' })
    await panel.getByRole('radio', { name: /Neighborhood lane/ }).click()
    // A change to the layout, shown at once and saved with it (it saves itself, ISS-027).
    await page.getByRole('button', { name: 'Fit scene' }).click()
    await shot(page, '3d-scene-panel')
    // The street never gets between a person and their tables.
    const lists = page.getByRole('complementary', { name: 'Navigate the building' })
    await lists.getByRole('button', { name: 'Tables', exact: true }).click()
    await lists.getByTestId('list-table-L1').click()
    await expect.poll(() => page.getByTestId('table-card').textContent()).toContain('L1')
    await page.getByRole('button', { name: 'Cutaway' }).click()
    await shot(page, '3d-neighborhood-lane-cutaway')
    // The benchmark (step 3h): a panel to run it and copy its report (its numbers come from a real device).
    const bench = page.getByTestId('benchmark')
    await bench.getByRole('button', { name: 'Run benchmark' }).waitFor()
    expect(await bench.textContent()).toContain('three 20 s orbits')
    await save(page)
    expect((await savedLayout(page)).scene).toEqual({ preset: 'neighborhood-lane' })

    // This device hides the surroundings: its own choice, not a change to the layout.
    await panel.getByRole('switch', { name: 'Show surroundings' }).click()
    await page.getByRole('button', { name: 'Fit building' }).waitFor()
    expect(await saveButton(page).isDisabled()).toBe(true)

    // Another device opens the branch: the saved lane, with its own playback (surroundings shown).
    const phone = await signedIn(390, 844)
    await phone.goto(url(branchPath(lab.branchId, '3d')), { waitUntil: 'hydration' })
    await drawn(phone)
    await phone.getByRole('button', { name: 'Fit scene' }).waitFor()
    await phone.getByTestId('scene-button').click()
    const sheet = phone.getByRole('dialog', { name: 'Scene' })
    expect(await sheet.getByRole('radio', { name: /Neighborhood lane/ }).getAttribute('aria-checked')).toBe('true')
    expect(await sheet.getByRole('switch', { name: 'Show surroundings' }).getAttribute('aria-checked')).toBe('true')
    // The sheet fits the phone once it has slid in, and nothing scrolls sideways.
    await expect.poll(async () => {
      const box = await sheet.boundingBox()
      return !!box && box.x >= 0 && box.x + box.width <= 390
    }).toBe(true)
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await shot(phone, '3d-scene-panel-phone')
    // Back to no surroundings, saved, for the next tests.
    await sheet.getByRole('radio', { name: /No surroundings/ }).click()
    await phone.keyboard.press('Escape')
    await phone.getByRole('button', { name: 'Fit building' }).waitFor()
    await save(phone)
    expect((await savedLayout(phone)).scene).toEqual({ preset: 'none' })

    // The first device, with nothing unsaved, takes that save on its next refetch (here the
    // connection coming back): the same drawing with another scene is news, never kept as its own,
    // which its next save would put back over the other device's choice.
    await page.context().setOffline(true)
    await page.context().setOffline(false)
    await expect.poll(() => panel.getByRole('radio', { name: /No surroundings/ }).getAttribute('aria-checked')).toBe('true')
    expect(await saveButton(page).isDisabled()).toBe(true)
  })

  it('publishes and withdraws an Explore layout with a branch pin and street door', { timeout: 120_000 }, async () => {
    const page = await signedIn(390, 844)
    const branchId = lab.annexBranchId
    const path = `/c/${lab.slug}/admin/branches/${branchId}`
    const publicPath = (slug = lab.slug) => url(`/api/c/${slug}/public/explore/branches/${branchId}`)
    const existing = await savedLayout(page, branchId)
    const prepared = await page.request.put(url(`${api(branchId)}/layout`), { headers: { origin: new URL(page.url()).origin }, data: {
      version: existing.version,
      layout: {
        floors: [{
          id: 'ground-explore', name: 'Ground', height: 300, hasRoof: true,
          outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 500 }, { x: 0, y: 500 }],
          edges: [
            { kind: 'wall', openings: [{ id: 'side-door', kind: 'door', offset: 100, width: 100 }] },
            { kind: 'wall', openings: [] },
            { kind: 'wall', openings: [{ id: 'street-door', kind: 'door', offset: 200, width: 100 }] },
            { kind: 'wall', openings: [] },
          ],
          walls: [],
          items: [],
        }],
        placements: [],
      },
    } })
    expect(prepared.status()).toBe(200)
    expect((await fetch(publicPath())).status).toBe(404)

    await page.goto(url(path), { waitUntil: 'hydration' })
    const latitude = page.getByLabel('Latitude', { exact: true })
    await latitude.waitFor()
    await latitude.evaluate((field) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', '11.5564, 104.9282')
      field.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    })
    await expect.poll(() => latitude.inputValue()).toBe('11.5564')
    await expect.poll(() => page.getByLabel('Longitude', { exact: true }).inputValue()).toBe('104.9282')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(async () => {
      const response = await fetch(url(`/api/c/${lab.slug}/public/branches`))
      const options = await response.json() as { id: string, latitude: number }[]
      return options.find(option => option.id === branchId)?.latitude
    }).toBe(11.5564)

    await openDesign(page, branchId)
    // Explore settings is in Properties with nothing selected; on a phone Properties opens first (D277).
    async function openExplore() {
      await page.getByRole('button', { name: 'Properties' }).click()
      await page.getByRole('button', { name: 'Explore settings' }).click()
    }
    const dialog = page.getByRole('dialog', { name: 'Explore settings' })
    const toggle = dialog.getByRole('switch', { name: 'Show in Explore' })
    await openExplore()
    expect(await toggle.isDisabled()).toBe(true)
    await dialog.getByRole('combobox', { name: 'Street door' }).click()
    await page.getByRole('option', { name: 'Front edge · Door 1' }).click()
    await toggle.click()
    await shot(page, 'explore-settings-phone')
    await dialog.getByRole('button', { name: 'Done' }).click()
    // Saved a moment later by itself (ISS-027): Explore shows it then.
    await save(page)

    const published = await fetch(publicPath())
    expect(published.status).toBe(200)
    expect(published.headers.get('cache-control')).toContain('no-store')
    expect(await published.json()).toMatchObject({ scene: { entrance: 'street-door', explore: true } })
    expect((await fetch(publicPath(seed.secondCafe.slug))).status).toBe(404)

    await openExplore()
    await toggle.click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await save(page)
    expect((await fetch(publicPath())).status).toBe(404)
  })

  it('version history (ISS-027): lists kept versions; Restore is one undo step and saves itself', { timeout: 60_000 }, async () => {
    const page = await signedIn()
    await openDesign(page)
    await plan(page).getByTestId('plan-table-L1').waitFor()
    const before = await savedLayout(page)
    await page.getByRole('button', { name: 'Version history' }).click()
    const list = page.getByTestId('layout-history')
    await list.waitFor()
    const restore = list.getByRole('button', { name: /^Restore version/ }).and(page.locator(':not([disabled])')).first()
    await restore.click()
    await page.getByText(/Version \d+ restored/).first().waitFor()
    await save(page)
    // Undo brings back what was there, and that saves too.
    await page.keyboard.press('ControlOrMeta+z')
    await save(page)
    const after = await savedLayout(page)
    expect(after.floors.map(floor => floor.id)).toEqual(before.floors.map(floor => floor.id))
    expect(after.placements).toEqual(before.placements)
  })
})
