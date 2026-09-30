import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateItemInput, MenuItem } from '#shared/contracts/menu-items'
import type { OptionSet } from '#shared/contracts/menu-options'
import { member, organization } from '#server/db/tables'
import type { BranchActor, SessionUser } from '#server/features/identity'
import { authorizeBranch } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { createCategory } from '#server/features/menu/categories.service'
import { archiveItem, createItem, restoreItem, updateItem } from '#server/features/menu/items.service'
import { branchItemStates } from '#server/features/menu/menu.schema'
import { createOptionSet } from '#server/features/menu/options.service'
import { listSoldOut, setSoldOut } from '#server/features/menu/soldout.service'
import { createTestDb, createUser } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
let branchA: string
let branchB: string
let atA: BranchActor
let atB: BranchActor
let category: string
let size: OptionSet
let temp: OptionSet
const admin = { userId: 'admin-1', role: 'admin' as const }

async function addBranch() {
  const id = newId()
  await db.insert(organization).values({ id, name: `Branch ${id}`, slug: id, timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  return id
}

beforeEach(async () => {
  db = await createTestDb()
  branchA = await addBranch()
  branchB = await addBranch()
  atA = { userId: 'staff-a', role: 'customer', branchId: branchA, branchRole: 'staff', requestId: 'req-a' }
  atB = { userId: 'staff-b', role: 'customer', branchId: branchB, branchRole: 'staff' }
  category = (await createCategory(db, admin, { name: 'Coffee', description: '', parentId: null, availabilityRuleIds: [] })).id
  size = await createOptionSet(db, admin, { name: 'Size', values: ['Small', 'Large'] })
  temp = await createOptionSet(db, admin, { name: 'Temperature', values: ['Hot', 'Iced'] })
})

const valueId = (set: OptionSet, name: string) => set.values.find(v => v.name === name)!.id

/** Every combination of the sets' values, all on sale at $3. */
function grid(sets: OptionSet[]) {
  const rows = sets.reduce<string[][]>((acc, set) => acc.flatMap(row => set.values.map(v => [...row, v.id])), [[]])
  return rows.map(valueIds => ({ valueIds, priceMinor: 300, status: 'active' as const }))
}

const item = (name: string, sets: OptionSet[], overrides: Partial<CreateItemInput> = {}) => createItem(db, admin, {
  categoryId: category,
  name,
  description: '',
  imageId: null,
  optionSetIds: sets.map(s => s.id),
  variations: sets.length ? grid(sets) : [{ valueIds: [], priceMinor: 250, status: 'active' }],
  modifierGroups: [],
  availabilityRuleIds: [],
  ...overrides,
})

const version = (menuItem: MenuItem, label: string) => menuItem.variations.find(v => v.label === label)!.id
const soldOut = async (actor: BranchActor) => (await listSoldOut(db, actor)).variations.map(v => `${v.itemName} ${v.label}`.trim())

describe('sold out at a branch', () => {
  it('switches versions off, listed by item and version, audited with the branch', async () => {
    const latte = await item('Latte', [size])
    const croissant = await item('Croissant', [])
    const list = await setSoldOut(db, atA, { variationIds: [version(latte, 'Large'), croissant.variations[0]!.id], soldOut: true })
    expect(list.branchId).toBe(branchA)
    expect(list.variations.map(v => [v.itemName, v.label, v.updatedBy])).toEqual([['Croissant', '', 'staff-a'], ['Latte', 'Large', 'staff-a']])
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'menu.sold_out.set'))
    expect(audit).toMatchObject({ actorId: 'staff-a', branchId: branchA, targetType: 'branch', targetId: branchA, requestId: 'req-a' })
    expect(audit!.metadata).toEqual({ soldOut: true, variationIds: [version(latte, 'Large'), croissant.variations[0]!.id] })
  })

  it('names who switched it off (D105); an account that no longer exists has no name', async () => {
    const sophea = await createUser(db, 'sophea@example.com', 'Sophea Keo')
    const latte = await item('Latte', [size])
    await setSoldOut(db, { ...atA, userId: sophea.id }, { variationIds: [version(latte, 'Small')], soldOut: true })
    await setSoldOut(db, atA, { variationIds: [version(latte, 'Large')], soldOut: true })
    const list = await listSoldOut(db, atA)
    expect(list.variations.map(v => [v.label, v.updatedByName])).toEqual([['Small', 'Sophea Keo'], ['Large', null]])
  })

  it('is per branch: sold out at one, still on sale at the other', async () => {
    const latte = await item('Latte', [size])
    await setSoldOut(db, atA, { variationIds: [version(latte, 'Small')], soldOut: true })
    expect(await soldOut(atA)).toEqual(['Latte Small'])
    expect(await soldOut(atB)).toEqual([])
    await setSoldOut(db, atB, { variationIds: [version(latte, 'Small')], soldOut: false })
    expect(await soldOut(atA)).toEqual(['Latte Small'])
  })

  it('puts versions back on sale, recording who did it', async () => {
    const latte = await item('Latte', [size])
    await setSoldOut(db, atA, { variationIds: [version(latte, 'Small'), version(latte, 'Large')], soldOut: true })
    const other: BranchActor = { ...atA, userId: 'manager-a', branchRole: 'manager' }
    expect((await setSoldOut(db, other, { variationIds: [version(latte, 'Small')], soldOut: false })).variations.map(v => v.label)).toEqual(['Large'])
    const rows = await db.select().from(branchItemStates).where(eq(branchItemStates.variationId, version(latte, 'Small')))
    expect(rows).toMatchObject([{ soldOut: false, updatedBy: 'manager-a' }])
    await setSoldOut(db, { ...atA, userId: 'staff-a2' }, { variationIds: [version(latte, 'Small')], soldOut: false })
    expect(await db.select().from(branchItemStates).where(eq(branchItemStates.variationId, version(latte, 'Small')))).toMatchObject([{ updatedBy: 'manager-a' }])
    // And off again.
    expect(await setSoldOut(db, atA, { variationIds: [version(latte, 'Small')], soldOut: true }).then(l => l.variations.map(v => v.label))).toEqual(['Small', 'Large'])
  })

  it('sets a state rather than toggling: repeating it changes nothing, and keeps who did it first', async () => {
    const latte = await item('Latte', [size])
    const id = version(latte, 'Large')
    const first = await setSoldOut(db, atA, { variationIds: [id], soldOut: true })
    const again = await setSoldOut(db, { ...atA, userId: 'staff-a2' }, { variationIds: [id], soldOut: true })
    expect(again.variations).toEqual(first.variations)
    // Back on sale for something never switched off stores nothing.
    await setSoldOut(db, atA, { variationIds: [version(latte, 'Small')], soldOut: false })
    expect(await db.select().from(branchItemStates)).toHaveLength(1)
  })

  it('ends in the state asked for when two people press at once', async () => {
    const latte = await item('Latte', [size])
    const ids = latte.variations.map(v => v.id)
    await Promise.all([
      setSoldOut(db, atA, { variationIds: ids, soldOut: true }),
      setSoldOut(db, { ...atA, userId: 'staff-a2' }, { variationIds: ids, soldOut: true }),
    ])
    expect(await soldOut(atA)).toEqual(['Latte Small', 'Latte Large'])
    expect(await db.select().from(branchItemStates)).toHaveLength(2)
  })

  it('labels versions in the item\'s option-set order', async () => {
    const latte = await item('Latte', [temp, size])
    const iced = latte.variations.find(v => v.valueIds.join() === [valueId(temp, 'Iced'), valueId(size, 'Large')].join())!
    expect(iced.label).toBe('Iced, Large')
    expect((await setSoldOut(db, atA, { variationIds: [iced.id], soldOut: true })).variations[0]!.label).toBe('Iced, Large')
  })

  it('accepts drafts and switched-off versions: the switch applies once they are sold', async () => {
    const latte = await item('Latte', [size], {
      variations: [{ valueIds: [valueId(size, 'Small')], priceMinor: 300, status: 'active' }, { valueIds: [valueId(size, 'Large')], priceMinor: null, status: 'disabled' }],
    })
    expect(latte.status).toBe('draft')
    await expect(setSoldOut(db, atA, { variationIds: latte.variations.map(v => v.id), soldOut: true })).resolves.toMatchObject({ variations: [{ label: 'Small' }, { label: 'Large' }] })
  })

  it('refuses unknown and retired versions and archived items, naming the version; nothing changes', async () => {
    const latte = await item('Latte', [size])
    const croissant = await item('Croissant', [])
    const ok = version(latte, 'Small')
    await expectApiError(() => setSoldOut(db, atA, { variationIds: [ok, newId()], soldOut: true }), 422, 'VARIATION_NOT_AVAILABLE', ['variationIds.1'])

    // Removing the option set retires the Size versions.
    const plain = await updateItem(db, admin, latte.id, { version: latte.version, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }] })
    await expectApiError(() => setSoldOut(db, atA, { variationIds: [plain.variations[0]!.id, ok], soldOut: true }), 422, 'VARIATION_NOT_AVAILABLE', ['variationIds.1'])

    await archiveItem(db, admin, croissant.id, { version: croissant.version })
    await expectApiError(() => setSoldOut(db, atA, { variationIds: [croissant.variations[0]!.id], soldOut: false }), 422, 'VARIATION_NOT_AVAILABLE', ['variationIds.0'])
    expect(await db.select().from(branchItemStates)).toHaveLength(0)
  })

  it('hides the switches of an archived item, and shows them again when it returns', async () => {
    const croissant = await item('Croissant', [])
    await setSoldOut(db, atA, { variationIds: [croissant.variations[0]!.id], soldOut: true })
    const archived = await archiveItem(db, admin, croissant.id, { version: croissant.version })
    expect(await soldOut(atA)).toEqual([])
    await restoreItem(db, admin, croissant.id, { version: archived.version })
    expect(await soldOut(atA)).toEqual(['Croissant'])
  })

  it('hides the switch of a version removed from the grid, and shows it again when the version returns', async () => {
    const latte = await item('Latte', [size])
    await setSoldOut(db, atA, { variationIds: [version(latte, 'Large')], soldOut: true })
    const plain = await updateItem(db, admin, latte.id, { version: latte.version, optionSetIds: [], variations: [{ valueIds: [], priceMinor: 300, status: 'active' }] })
    expect(await soldOut(atA)).toEqual([])
    await updateItem(db, admin, latte.id, { version: plain.version, optionSetIds: [size.id], variations: grid([size]) })
    expect(await soldOut(atA)).toEqual(['Latte Large'])
  })
})

describe('who may switch', () => {
  async function staffOf(branchId: string, role: string): Promise<SessionUser> {
    const account = await createUser(db)
    await db.insert(member).values({ id: newId(), organizationId: branchId, userId: account.id, role, createdAt: new Date() })
    return { id: account.id, emailVerified: true, role: 'customer' }
  }

  it('lets staff and managers switch at their own branch only', async () => {
    const staff = await staffOf(branchA, 'staff')
    const manager = await staffOf(branchA, 'manager')
    await expect(authorizeBranch(db, staff, branchA, { menu: ['setSoldOut'] })).resolves.toMatchObject({ branchId: branchA, branchRole: 'staff' })
    await expect(authorizeBranch(db, manager, branchA, { menu: ['setSoldOut'] })).resolves.toMatchObject({ branchRole: 'manager' })
    await expectApiError(() => authorizeBranch(db, staff, branchB, { menu: ['setSoldOut'] }), 404, 'NOT_FOUND')
  })

  it('refuses customers who aren\'t branch staff', async () => {
    const customer = await createUser(db)
    await expectApiError(() => authorizeBranch(db, { id: customer.id, emailVerified: true, role: 'customer' }, branchA, { menu: ['setSoldOut'] }), 404, 'NOT_FOUND')
  })
})
