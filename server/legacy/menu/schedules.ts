import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { InferSelectModel, SQL } from 'drizzle-orm'
import type { Page } from '#shared/contracts/common'
import { totalPages } from '#shared/contracts/common'
import type { CreateScheduleBody, Day, Schedule, ScheduleDetail, ScheduleOption, UpdateScheduleBody } from '#shared/contracts/menu'
import { DAYS, SCHEDULE_END_AFTER_START } from '#shared/contracts/menu'
import { auditEvents, menuProducts, menuSchedules, productSchedules } from '../../db/tables'
import type { Db } from '../../utils/batch'
import { isForeignKeyError, isStaleWrite, requireOneChange } from '../../utils/batch'
import { toIso } from '../../utils/time'
import { apiError, notFound, versionConflict } from '../../utils/errors'
import type { Actor } from '../identity/service'

type ScheduleRow = InferSelectModel<typeof menuSchedules>

// --- Encoding: days as a bitmask (Monday = 1), times as minutes after midnight ---

export const dayBit = (day: Day) => 1 << DAYS.indexOf(day)
export const daysToMask = (days: readonly Day[]) => days.reduce((mask, day) => mask | dayBit(day), 0)
export const maskToDays = (mask: number): Day[] => DAYS.filter(day => (mask & dayBit(day)) !== 0)
export const timeToMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
export const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const productCount = sql<number>`(select count(*) from ${productSchedules} where ${productSchedules.scheduleId} = ${menuSchedules.id})`

function toSchedule(row: ScheduleRow, products: number): Schedule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    days: maskToDays(row.days),
    startTime: minutesToTime(row.startMinute),
    endTime: minutesToTime(row.endMinute),
    timeZone: row.timeZone,
    status: row.status,
    productCount: products,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

const audit = (db: Db, actor: Actor, action: string, targetId: string, metadata?: Record<string, unknown>) =>
  db.insert(auditEvents).values({ actorUserId: actor.userId, action, targetType: 'menu_schedule', targetId, metadata })

export interface ScheduleFilters {
  page: number
  pageSize: number
  search?: string
  status?: 'ACTIVE' | 'INACTIVE'
  day?: Day
}

export async function listSchedules(db: Db, query: ScheduleFilters): Promise<Page<Schedule>> {
  const conditions: SQL[] = []
  if (query.search) conditions.push(sql`instr(lower(${menuSchedules.name}), ${query.search.toLowerCase()}) > 0`)
  if (query.status) conditions.push(eq(menuSchedules.status, query.status))
  if (query.day) conditions.push(sql`(${menuSchedules.days} & ${dayBit(query.day)}) != 0`)
  const where = conditions.length ? and(...conditions) : undefined

  const [[total], rows] = await Promise.all([
    db.select({ n: count() }).from(menuSchedules).where(where),
    db.select({ row: menuSchedules, products: productCount }).from(menuSchedules).where(where)
      .orderBy(asc(sql`lower(${menuSchedules.name})`), asc(menuSchedules.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
  ])
  return {
    items: rows.map(r => toSchedule(r.row, r.products)),
    page: query.page,
    pageSize: query.pageSize,
    total: total!.n,
    totalPages: totalPages(total!.n, query.pageSize),
  }
}

/** Every schedule (all statuses), for pickers. */
export async function listScheduleOptions(db: Db): Promise<ScheduleOption[]> {
  return db.select({ id: menuSchedules.id, name: menuSchedules.name, status: menuSchedules.status })
    .from(menuSchedules).orderBy(asc(sql`lower(${menuSchedules.name})`))
}

export async function getSchedule(db: Db, id: string): Promise<ScheduleDetail> {
  const [found] = await db.select({ row: menuSchedules, products: productCount }).from(menuSchedules).where(eq(menuSchedules.id, id))
  if (!found) throw notFound('The schedule')
  const products = await db
    .select({ id: menuProducts.id, name: menuProducts.name, status: menuProducts.status })
    .from(productSchedules)
    .innerJoin(menuProducts, eq(menuProducts.id, productSchedules.productId))
    .where(eq(productSchedules.scheduleId, id))
    .orderBy(asc(sql`lower(${menuProducts.name})`))
  return { ...toSchedule(found.row, found.products), products }
}

/** New schedules are in the cafe's zone (`timeZone`, from the server configuration, D41). */
export async function createSchedule(db: Db, actor: Actor, input: Required<CreateScheduleBody>, timeZone: string): Promise<ScheduleDetail> {
  const id = crypto.randomUUID()
  await db.batch([
    db.insert(menuSchedules).values({
      id,
      name: input.name,
      description: input.description,
      days: daysToMask(input.days),
      startMinute: timeToMinutes(input.startTime),
      endMinute: timeToMinutes(input.endTime),
      timeZone,
      status: input.status,
    }),
    audit(db, actor, 'menu_schedule.create', id, { name: input.name }),
  ])
  return getSchedule(db, id)
}

/**
 * Partial update, only from the current `version`. Menu items are linked from the menu-item side
 * (`scheduleIds`), never here, so an edit can't drop links it didn't know about.
 */
export async function updateSchedule(db: Db, actor: Actor, id: string, input: UpdateScheduleBody): Promise<ScheduleDetail> {
  const [current] = await db.select().from(menuSchedules).where(eq(menuSchedules.id, id))
  if (!current) throw notFound('The schedule')
  if (current.version !== input.version) throw versionConflict('This schedule')

  const startMinute = input.startTime === undefined ? current.startMinute : timeToMinutes(input.startTime)
  const endMinute = input.endTime === undefined ? current.endMinute : timeToMinutes(input.endTime)
  if (endMinute <= startMinute) {
    throw apiError(400, 'VALIDATION_FAILED', 'Some of the submitted data is invalid.', { fieldErrors: { endTime: [SCHEDULE_END_AFTER_START] } })
  }

  const changes = {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.days === undefined ? {} : { days: daysToMask(input.days) }),
    ...(input.status === undefined ? {} : { status: input.status }),
    startMinute,
    endMinute,
  }
  try {
    await db.batch([
      db.update(menuSchedules)
        .set({ ...changes, version: sql`${menuSchedules.version} + 1` })
        .where(and(eq(menuSchedules.id, id), eq(menuSchedules.version, input.version))),
      requireOneChange(db),
      audit(db, actor, 'menu_schedule.update', id, { fields: Object.keys(input).filter(k => k !== 'version') }),
    ])
  }
  catch (error) {
    if (isStaleWrite(error)) throw versionConflict('This schedule')
    throw error
  }
  return getSchedule(db, id)
}

const inUse = (name: string, products: number) => apiError(
  409,
  'SCHEDULE_IN_USE',
  `"${name}" is used by ${products === 1 ? '1 menu item' : `${products} menu items`}. Remove it from their schedules first.`,
)

/**
 * Deletes a schedule no menu item follows. What deleting a schedule in use should do to its
 * menu items isn't decided (Q16), so it's refused; the foreign key refuses it on a race too.
 */
export async function deleteSchedule(db: Db, actor: Actor, id: string, version: number) {
  const [current] = await db.select({ row: menuSchedules, products: productCount }).from(menuSchedules).where(eq(menuSchedules.id, id))
  if (!current) throw notFound('The schedule')
  if (current.row.version !== version) throw versionConflict('This schedule')
  if (current.products > 0) throw inUse(current.row.name, current.products)
  try {
    await db.batch([
      db.delete(menuSchedules).where(and(eq(menuSchedules.id, id), eq(menuSchedules.version, version))),
      requireOneChange(db),
      audit(db, actor, 'menu_schedule.delete', id, { name: current.row.name }),
    ])
  }
  catch (error) {
    if (isStaleWrite(error)) throw versionConflict('This schedule')
    if (isForeignKeyError(error)) throw inUse(current.row.name, 1)
    throw error
  }
}
