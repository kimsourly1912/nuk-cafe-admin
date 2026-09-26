import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateScheduleBody } from '#shared/contracts/menu'
import type { Db } from '../../server/db/types'
import type { Actor } from '../../server/features/identity/service'
import { createCategory } from '../../server/features/menu/categories'
import { createProduct } from '../../server/features/menu/products'
import { createSchedule, daysToMask, deleteSchedule, getSchedule, listSchedules, maskToDays, updateSchedule } from '../../server/features/menu/schedules'
import { createAdmin, createTestDb } from './support/db'
import { failure } from './support/failure'

const ZONE = 'Asia/Phnom_Penh'

let db: Db
let actor: Actor
beforeEach(async () => {
  db = await createTestDb()
  actor = await createAdmin(db)
})

const input = (overrides: Partial<CreateScheduleBody> = {}): Required<CreateScheduleBody> => ({
  name: 'Breakfast',
  description: '',
  days: ['MONDAY', 'FRIDAY'],
  startTime: '07:00',
  endTime: '10:30',
  status: 'ACTIVE',
  ...overrides,
}) as Required<CreateScheduleBody>

async function productUsing(scheduleId: string) {
  const category = await createCategory(db, actor, { name: 'Tea', parentId: null, status: 'ACTIVE' })
  return createProduct(db, actor, { name: 'Sencha', description: '', categoryId: category.id, priceMinor: 300, imageAssetId: null, status: 'ACTIVE', scheduleIds: [scheduleId], variantGroups: [] })
}

describe('encoding', () => {
  it('stores days as a bitmask and returns them in week order', () => {
    expect(daysToMask(['MONDAY', 'SUNDAY'])).toBe(65)
    expect(maskToDays(daysToMask(['SUNDAY', 'WEDNESDAY', 'MONDAY']))).toEqual(['MONDAY', 'WEDNESDAY', 'SUNDAY'])
  })
})

describe('create and read', () => {
  it('returns local times in the cafe zone, with no menu items', async () => {
    const schedule = await createSchedule(db, actor, input(), ZONE)
    expect(schedule).toMatchObject({ name: 'Breakfast', days: ['MONDAY', 'FRIDAY'], startTime: '07:00', endTime: '10:30', timeZone: ZONE, productCount: 0, products: [], version: 1 })
  })

  it('filters by search, status and day, and paginates', async () => {
    await createSchedule(db, actor, input({ name: 'Breakfast' }), ZONE)
    await createSchedule(db, actor, input({ name: 'Brunch', days: ['SATURDAY'], status: 'INACTIVE' }), ZONE)
    await createSchedule(db, actor, input({ name: 'Lunch', days: ['MONDAY'] }), ZONE)
    const names = async (q: Parameters<typeof listSchedules>[1]) => (await listSchedules(db, q)).items.map(s => s.name)

    expect(await names({ page: 1, pageSize: 20, search: 'br' })).toEqual(['Breakfast', 'Brunch'])
    expect(await names({ page: 1, pageSize: 20, status: 'INACTIVE' })).toEqual(['Brunch'])
    expect(await names({ page: 1, pageSize: 20, day: 'MONDAY' })).toEqual(['Breakfast', 'Lunch'])
    const page2 = await listSchedules(db, { page: 2, pageSize: 2 })
    expect(page2).toMatchObject({ total: 3, totalPages: 2, page: 2 })
    expect(page2.items.map(s => s.name)).toEqual(['Lunch'])
  })
})

describe('update', () => {
  it('keeps the menu items linked and checks the time against the stored one', async () => {
    const schedule = await createSchedule(db, actor, input(), ZONE)
    await productUsing(schedule.id)
    const updated = await updateSchedule(db, actor, schedule.id, { version: 1, name: 'Early' })
    expect(updated).toMatchObject({ name: 'Early', productCount: 1, version: 2 })
    expect(updated.products.map(p => p.name)).toEqual(['Sencha'])
    expect(await failure(updateSchedule(db, actor, schedule.id, { version: 2, endTime: '06:00' }))).toEqual({ status: 400, code: 'VALIDATION_FAILED' })
  })

  it('rejects a stale version', async () => {
    const schedule = await createSchedule(db, actor, input(), ZONE)
    await updateSchedule(db, actor, schedule.id, { version: 1, name: 'Early' })
    expect(await failure(updateSchedule(db, actor, schedule.id, { version: 1, name: 'Late' }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' })
  })
})

describe('delete', () => {
  it('deletes an unused schedule', async () => {
    const schedule = await createSchedule(db, actor, input(), ZONE)
    await deleteSchedule(db, actor, schedule.id, 1)
    expect(await failure(getSchedule(db, schedule.id))).toEqual({ status: 404, code: 'NOT_FOUND' })
  })

  it('refuses a schedule menu items follow', async () => {
    const schedule = await createSchedule(db, actor, input(), ZONE)
    await productUsing(schedule.id)
    expect(await failure(deleteSchedule(db, actor, schedule.id, 1))).toEqual({ status: 409, code: 'SCHEDULE_IN_USE' })
  })
})
