import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutGroupSchema, MAX_LAYOUT_GROUPS } from '#shared/contracts/shop-layout'
import type { CreateLayoutGroupInput } from '#shared/contracts/shop-layout'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { createGroup, deleteGroup, listGroups } from '#server/features/branches/branches.groups.service'
import { findGroup } from '#server/features/branches/branches.groups.repository'
import { createTestDb, createUser, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'

// A cafe's saved groups (plan Phase 5, D284): pieces and walls under a name, for every branch,
// created and deleted at a version; another cafe's are never seen or touched.

let db: Db
let actor: Actor
const OTHER = 'tenant-other'

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  actor = { userId: (await createUser(db)).id, tenantId: TEST_TENANT, role: 'owner', requestId: 'req-1' }
})

const kitchen = (name: string): CreateLayoutGroupInput => ({
  name,
  items: [{ id: 'counter', kind: 'service-counter', x: -60, y: 0, rotation: 0, width: 200, depth: 60, finishes: {} }],
  walls: [{ id: 'back', from: { x: -150, y: -60 }, to: { x: 150, y: -60 }, openings: [{ id: 'hatch', kind: 'door', offset: 100, width: 90 }] }],
})

describe('saved groups (D284)', () => {
  it('saves, lists by name and deletes a group at its version, audited', async () => {
    const saved = await createGroup(db, actor, kitchen('Kitchen corner'))
    expect(saved).toMatchObject({ name: 'Kitchen corner', version: 1, items: [{ id: 'counter' }], walls: [{ id: 'back', openings: [{ id: 'hatch' }] }] })
    await createGroup(db, actor, kitchen('Bar'))
    expect((await listGroups(db, TEST_TENANT)).map(group => group.name)).toEqual(['Bar', 'Kitchen corner'])
    await expectApiError(() => deleteGroup(db, actor, saved.id, { version: 2 }), 409, 'VERSION_CONFLICT')
    await deleteGroup(db, actor, saved.id, { version: 1 })
    expect(await findGroup(db, TEST_TENANT, saved.id)).toBeUndefined()
    const actions = (await db.select().from(auditEvents).where(eq(auditEvents.targetId, saved.id))).map(row => row.action)
    expect(actions).toEqual(['branch.group.create', 'branch.group.delete'])
  })

  it('refuses a name in use (any capitals) and more than the limit, also when two creates race', async () => {
    await createGroup(db, actor, kitchen('Bar'))
    await expectApiError(() => createGroup(db, actor, kitchen('BAR')), 409, 'GROUP_NAME_TAKEN')
    for (let n = 1; n < MAX_LAYOUT_GROUPS; n++) await createGroup(db, actor, kitchen(`Group ${n}`))
    await expectApiError(() => createGroup(db, actor, kitchen('One more')), 409, 'GROUP_LIMIT')
  })

  it('the last place goes to one of two creates at once', async () => {
    for (let n = 1; n < MAX_LAYOUT_GROUPS; n++) await createGroup(db, actor, kitchen(`Group ${n}`))
    // Another create lands after this one read the count, before its write: the batch's guard refuses this one.
    const racing = interleaved(db, () => createGroup(db, actor, kitchen('Meanwhile')))
    await expectApiError(() => createGroup(racing, actor, kitchen('Racing')), 409, 'GROUP_LIMIT')
    expect((await listGroups(db, TEST_TENANT)).map(group => group.name)).toContain('Meanwhile')
    expect(await listGroups(db, TEST_TENANT)).toHaveLength(MAX_LAYOUT_GROUPS)
  })

  it('another cafe\'s groups are not listed, found or deleted', async () => {
    await ensureTenant(db, OTHER, 'other')
    const theirs = await createGroup(db, { ...actor, tenantId: OTHER }, kitchen('Theirs'))
    expect(await listGroups(db, TEST_TENANT)).toEqual([])
    await expectApiError(() => deleteGroup(db, actor, theirs.id, { version: 1 }), 404, 'NOT_FOUND')
    expect(await findGroup(db, OTHER, theirs.id)).toBeDefined()
    // The same name is free in another cafe.
    expect(await createGroup(db, actor, kitchen('Theirs'))).toMatchObject({ name: 'Theirs' })
  })

  it('the contract refuses an empty group, repeated ids and an invalid piece', () => {
    const messages = (input: unknown) => (v.safeParse(createLayoutGroupSchema, input).issues ?? []).map(issue => issue.message)
    expect(messages(kitchen('Fine'))).toEqual([])
    expect(messages({ name: 'Empty', items: [], walls: [] })).toContain('Select pieces or walls to save')
    expect(messages({ ...kitchen('Twice'), walls: [{ id: 'counter', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }] })).toContain('Item ids repeat')
    expect(messages({ ...kitchen('Bad'), items: [{ id: 'x', kind: 'plant', x: 0.5, y: 0, rotation: 0, width: 50, depth: 50, finishes: {} }] }).length).toBeGreaterThan(0)
  })
})
