import type { BranchSettings, CreateTableInput, DiningTable, PublicBranch, PublicTable, TableListQuery, TableVersionInput, UpdateBranchSettingsInput, UpdateTableInput } from '#shared/contracts/branches'
import { MAX_BRANCH_TABLES } from '#shared/contracts/branches'
import type { WeeklyWindow } from '#shared/contracts/common'
import type { Db, Statement } from '../../utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { notFound } from '../../utils/errors'
import { toIso } from '../../utils/time'
import { isInWindow, isKnownTimeZone, localTime, minutesUntilClosed, nextStart, sortWindows, windowsProblem } from '../../utils/weekly-windows'
import type { Actor } from '../identity'
import { auditStatement } from '../platform'
import { branchArchived, branchChanged, branchHoursProblem, branchNotFound, tableArchived, tableChanged, tableLabelTaken, tableLimit, tableNotArchived, tableNotFound, unknownTimezone } from './branches.errors'
import type { QrConfig } from './branches.qr'
import { isTokenShaped, tableQrUrl, tableToken, tokenHash } from './branches.qr'
import * as repo from './branches.repository'
import type { BranchRow, TableRow } from './branches.repository'

/**
 * Branches (docs/server/data-model.md → Branches, D44, D91). The seed task creates them; the admin
 * edits their settings and hours (one `version` on the branch covers both) and their dining tables
 * (each with its own `version`). QR tokens: `branches.qr.ts`.
 */

export interface SeededBranch {
  id: string
  name: string
}

/**
 * The seed task's demo branch, only while no branch exists (so it runs safely on every deploy of a
 * disposable environment). Returns `null` when branches already exist.
 */
export async function seedDemoBranch(db: Db, input: { timezone: string }): Promise<SeededBranch | null> {
  if (await repo.hasAnyBranch(db)) return null
  const branch = { id: newId(), name: 'Main branch', slug: 'main', timezone: input.timezone, now: new Date() }
  await db.batch([repo.insertBranchStatement(db, branch)])
  return { id: branch.id, name: branch.name }
}

/** Active branches (id and name), for pickers such as the staff form's. */
export async function listBranchOptions(db: Db): Promise<repo.BranchOptionRow[]> {
  return repo.listActiveBranches(db)
}

/** The branch as customers see it at `now`: open by its hours on its own clock, or when it opens. */
function toPublicBranch(branch: BranchRow, hours: WeeklyWindow[], now: Date): PublicBranch {
  const at = localTime(now, branch.timezone)
  const openNow = hours.some(window => isInWindow(window, at))
  return {
    id: branch.id,
    name: branch.name,
    address: branch.address ?? null,
    phone: branch.phone ?? null,
    timezone: branch.timezone,
    openNow,
    closesInMinutes: openNow ? minutesUntilClosed(hours, at) : null,
    nextOpening: openNow ? null : nextStart(hours, at),
  }
}

/** An active branch for customers (the menu's header, D93); unknown and archived ones are 404. */
export async function getPublicBranch(db: Db, id: string, now = new Date()): Promise<PublicBranch> {
  const branch = await repo.findBranch(db, id)
  if (!branch || branch.status !== 'active') throw notFound('This branch')
  return toPublicBranch(branch, await repo.hoursOf(db, id), now)
}

/** The labels of a branch's active tables (no QR links: for counts and sample data, D94). */
export async function activeTableLabels(db: Db, branchId: string): Promise<string[]> {
  return (await repo.listTables(db, branchId, 'active')).map(table => table.label)
}

/** Every active branch for customers, by name (launch has one, D45). */
export async function listPublicBranches(db: Db, now = new Date()): Promise<PublicBranch[]> {
  const options = await repo.listActiveBranches(db)
  return Promise.all(options.map(option => getPublicBranch(db, option.id, now)))
}

// --- Settings and hours ---

const audit = (db: Db, actor: Actor, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `branch.${action}`, targetType, targetId, metadata })

async function loadBranch(db: Db, id: string): Promise<BranchRow> {
  const branch = await repo.findBranch(db, id)
  if (!branch) throw branchNotFound()
  return branch
}

/** The branch's settings, and whether it's open at `now` (its hours, in its timezone). */
export async function getBranchSettings(db: Db, id: string, now = new Date()): Promise<BranchSettings> {
  const branch = await loadBranch(db, id)
  const hours = await repo.hoursOf(db, id)
  const at = localTime(now, branch.timezone)
  return {
    id: branch.id,
    name: branch.name,
    timezone: branch.timezone,
    address: branch.address ?? null,
    phone: branch.phone ?? null,
    status: branch.status === 'archived' ? 'archived' : 'active',
    hours,
    openNow: hours.some(window => isInWindow(window, at)),
    today: at.weekday,
    version: branch.version ?? 1,
  }
}

/** Saves the fields sent, from the version read: details and hours together, audited. */
export async function updateBranchSettings(db: Db, actor: Actor, id: string, input: UpdateBranchSettingsInput): Promise<BranchSettings> {
  const branch = await loadBranch(db, id)
  if (branch.status === 'archived') throw branchArchived()
  if ((branch.version ?? 1) !== input.version) throw branchChanged()
  if (input.timezone !== undefined && !isKnownTimeZone(input.timezone)) throw unknownTimezone(input.timezone)
  let hours
  if (input.hours) {
    const problem = windowsProblem(input.hours, 'hours')
    if (problem) throw branchHoursProblem(problem)
    hours = sortWindows(input.hours)
  }

  const changes = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.address !== undefined && { address: input.address }),
    ...(input.phone !== undefined && { phone: input.phone }),
  }
  const changed = Object.fromEntries(Object.entries(changes)
    .filter(([key, value]) => value !== branch[key as keyof BranchRow])
    .map(([key, value]) => [key, { from: branch[key as keyof BranchRow] ?? null, to: value }]))
  const before = hours && await repo.hoursOf(db, id)

  try {
    await db.batch([
      repo.touchBranchStatement(db, id, input.version, changes),
      requireOneChange(db),
      ...(hours ? repo.replaceHoursStatements(db, id, hours) : []),
      audit(db, actor, 'update', 'branch', id, { ...changed, ...(hours && { hours: { from: before, to: hours } }) }),
    ] as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isStaleWrite(error)) throw branchChanged()
    throw error
  }
  return getBranchSettings(db, id)
}

// --- Dining tables ---

/** "Table 2" before "Table 10": labels compared as people read them. */
const byLabel = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

async function toTable(row: TableRow, qr: QrConfig): Promise<DiningTable> {
  return {
    id: row.id,
    branchId: row.branchId,
    label: row.label,
    area: row.area,
    status: row.status,
    qrUrl: row.status === 'active' ? tableQrUrl(qr, await tableToken(qr.secret, row.id, row.qrVersion)) : null,
    qrRotatedAt: toIso(row.qrRotatedAt),
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function activeBranch(db: Db, branchId: string): Promise<BranchRow> {
  const branch = await loadBranch(db, branchId)
  if (branch.status === 'archived') throw branchArchived()
  return branch
}

async function loadTable(db: Db, branchId: string, tableId: string, qr: QrConfig): Promise<DiningTable> {
  const row = await repo.findTable(db, branchId, tableId)
  if (!row) throw tableNotFound()
  return toTable(row, qr)
}

/** The table, checked: in this branch, at the version read, and active (unless restoring). */
async function openTable(db: Db, branchId: string, tableId: string, version: number, allowArchived = false): Promise<TableRow> {
  const row = await repo.findTable(db, branchId, tableId)
  if (!row) throw tableNotFound()
  if (row.version !== version) throw tableChanged()
  if (!allowArchived && row.status !== 'active') throw tableArchived()
  return row
}

/** Runs a write on one table: a label clash is `tableLabelTaken`, a failed guard `tableChanged`. */
async function runTableBatch(db: Db, statements: Statement[], label: string) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw tableLabelTaken(label)
    if (isStaleWrite(error)) throw tableChanged()
    throw error
  }
}

export async function listTables(db: Db, branchId: string, query: TableListQuery, qr: QrConfig): Promise<DiningTable[]> {
  await loadBranch(db, branchId)
  const rows = await repo.listTables(db, branchId, query.status)
  rows.sort((a, b) => byLabel.compare(a.label, b.label))
  return Promise.all(rows.map(row => toTable(row, qr)))
}

/**
 * Adds a table with its first QR. At most `MAX_BRANCH_TABLES` per branch (a soft cap, checked
 * before the write: two simultaneous adds at the limit can both pass).
 */
export async function createTable(db: Db, actor: Actor, branchId: string, input: CreateTableInput, qr: QrConfig): Promise<DiningTable> {
  await activeBranch(db, branchId)
  if (await repo.countTables(db, branchId) >= MAX_BRANCH_TABLES) throw tableLimit()
  const id = newId()
  const hash = await tokenHash(await tableToken(qr.secret, id, 1))
  await runTableBatch(db, [
    repo.insertTableStatement(db, { id, branchId, label: input.label, area: input.area, qrTokenHash: hash, now: new Date() }),
    audit(db, actor, 'table.create', 'dining_table', id, { branchId, label: input.label, area: input.area }),
  ], input.label)
  return loadTable(db, branchId, id, qr)
}

/** Renames the table or changes its area; its QR stays the same. */
export async function updateTable(db: Db, actor: Actor, branchId: string, tableId: string, input: UpdateTableInput, qr: QrConfig): Promise<DiningTable> {
  const current = await openTable(db, branchId, tableId, input.version)
  const changes = {
    ...(input.label !== undefined && { label: input.label }),
    ...(input.area !== undefined && { area: input.area }),
  }
  await runTableBatch(db, [
    repo.touchTableStatement(db, tableId, input.version, new Date(), changes),
    requireOneChange(db),
    audit(db, actor, 'table.update', 'dining_table', tableId, {
      ...(input.label !== undefined && input.label !== current.label && { label: { from: current.label, to: input.label } }),
      ...(input.area !== undefined && input.area !== current.area && { area: { from: current.area, to: input.area } }),
    }),
  ], input.label ?? current.label)
  return loadTable(db, branchId, tableId, qr)
}

/** Archives the table: its QR stops working until it's restored. */
export async function archiveTable(db: Db, actor: Actor, branchId: string, tableId: string, input: TableVersionInput, qr: QrConfig): Promise<DiningTable> {
  const current = await openTable(db, branchId, tableId, input.version)
  await runTableBatch(db, [
    repo.touchTableStatement(db, tableId, input.version, new Date(), { status: 'archived' }),
    requireOneChange(db),
    audit(db, actor, 'table.archive', 'dining_table', tableId, {}),
  ], current.label)
  return loadTable(db, branchId, tableId, qr)
}

/** Restores the table with the same QR, unless an active table took its label meanwhile. */
export async function restoreTable(db: Db, actor: Actor, branchId: string, tableId: string, input: TableVersionInput, qr: QrConfig): Promise<DiningTable> {
  await activeBranch(db, branchId)
  const current = await openTable(db, branchId, tableId, input.version, true)
  if (current.status !== 'archived') throw tableNotArchived()
  await runTableBatch(db, [
    repo.touchTableStatement(db, tableId, input.version, new Date(), { status: 'active' }, true),
    requireOneChange(db),
    audit(db, actor, 'table.restore', 'dining_table', tableId, {}),
  ], current.label)
  return loadTable(db, branchId, tableId, qr)
}

/** Gives the table a new QR: the printed one stops working at once. */
export async function rotateTableQr(db: Db, actor: Actor, branchId: string, tableId: string, input: TableVersionInput, qr: QrConfig): Promise<DiningTable> {
  const current = await openTable(db, branchId, tableId, input.version)
  const qrVersion = current.qrVersion + 1
  const now = new Date()
  await runTableBatch(db, [
    repo.touchTableStatement(db, tableId, input.version, now, { qrVersion, qrTokenHash: await tokenHash(await tableToken(qr.secret, tableId, qrVersion)), qrRotatedAt: now }),
    requireOneChange(db),
    // Never the token itself (security.md → Logging).
    audit(db, actor, 'table.rotate_qr', 'dining_table', tableId, { qrVersion }),
  ], current.label)
  return loadTable(db, branchId, tableId, qr)
}

/**
 * The table a scanned QR names. Unknown tokens, archived tables and archived branches are all the
 * same 404, so a QR says nothing about why it doesn't work.
 */
export async function resolveTableToken(db: Db, token: string): Promise<PublicTable> {
  const row = isTokenShaped(token) ? await repo.findTableByTokenHash(db, await tokenHash(token)) : undefined
  if (!row || row.tableStatus !== 'active' || row.branchStatus !== 'active') throw tableNotFound()
  return { branch: { id: row.branchId, name: row.branchName }, table: { id: row.tableId, label: row.label } }
}
