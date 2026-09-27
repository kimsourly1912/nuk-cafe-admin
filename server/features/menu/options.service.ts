import type { AddOptionValueInput, CreateOptionSetInput, OptionSet, OptionSetListQuery, OptionVersionInput, RenameOptionSetInput, RenameOptionValueInput, ReorderOptionValuesInput } from '#shared/contracts/menu-options'
import { MAX_OPTION_VALUES } from '#shared/contracts/menu-options'
import type { Db, Statement } from '../../utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { toIso } from '../../utils/time'
import type { Actor } from '../identity'
import { auditStatement } from '../platform'
import { lastOptionValue, optionNotArchived, optionSetArchived, optionSetChanged, optionSetNameTaken, optionSetNotFound, optionValueArchived, optionValueNameTaken, optionValueNotFound, optionValuesChanged, tooManyOptionValues } from './options.errors'
import { itemCountsBySet } from './items.repository'
import * as repo from './options.repository'
import type { OptionSetRow, OptionValueRow } from './options.repository'

/**
 * The Options library (docs/server/data-model.md → Menu, D44, D58). The set's `version` is the lock
 * for the set and its values: every write first moves it from the version read (or fails), so
 * concurrent edits of one set never interleave.
 */

function toOptionSet(row: OptionSetRow, values: OptionValueRow[], itemCounts: Map<string, number>): OptionSet {
  const own = values.filter(v => v.setId === row.id)
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    values: [...own.filter(v => v.status === 'active'), ...own.filter(v => v.status !== 'active')]
      .map(v => ({ id: v.id, name: v.name, sortOrder: v.sortOrder, status: v.status })),
    itemCount: itemCounts.get(row.id) ?? 0,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function loadSet(db: Db, id: string): Promise<OptionSet> {
  const row = await repo.findSet(db, id)
  if (!row) throw optionSetNotFound()
  return toOptionSet(row, await repo.valuesOf(db, [id]), await itemCountsBySet(db, [id]))
}

/** The set, checked: exists, at the version read, and active (unless restoring). */
async function openSet(db: Db, id: string, version: number, allowArchived = false): Promise<OptionSetRow> {
  const set = await repo.findSet(db, id)
  if (!set) throw optionSetNotFound()
  if (set.version !== version) throw optionSetChanged()
  if (!allowArchived && set.status !== 'active') throw optionSetArchived()
  return set
}

async function openValue(db: Db, setId: string, valueId: string): Promise<OptionValueRow> {
  const value = await repo.findValue(db, setId, valueId)
  if (!value) throw optionValueNotFound()
  return value
}

const audit = (db: Db, actor: Actor, action: string, setId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `menu.option_set.${action}`, targetType: 'menu_option_set', targetId: setId, metadata })

/**
 * Runs a write on one set. A unique-index failure is `onNameTaken()`. A failed guard is either the
 * set changed meanwhile (its version moved) or `onCountGuard()` (too few or too many values).
 */
async function runSetBatch(db: Db, setId: string, version: number, statements: Statement[], onNameTaken: () => Error, onCountGuard: () => Error = optionSetChanged) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw onNameTaken()
    if (!isStaleWrite(error)) throw error
    const current = await repo.findSet(db, setId)
    throw current?.version === version ? onCountGuard() : optionSetChanged()
  }
}

export async function listOptionSets(db: Db, query: OptionSetListQuery): Promise<OptionSet[]> {
  const sets = await repo.listSets(db, query.status)
  const ids = sets.map(s => s.id)
  const [values, itemCounts] = await Promise.all([repo.valuesOf(db, ids), itemCountsBySet(db, ids)])
  return sets.map(set => toOptionSet(set, values, itemCounts))
}

export async function getOptionSet(db: Db, id: string): Promise<OptionSet> {
  return loadSet(db, id)
}

export async function createOptionSet(db: Db, actor: Actor, input: CreateOptionSetInput): Promise<OptionSet> {
  const id = newId()
  const now = new Date()
  const statements: Statement[] = [
    repo.insertSetStatement(db, { id, name: input.name, now }),
    repo.insertValuesStatement(db, input.values.map((name, i) => ({ id: newId(), setId: id, name, sortOrder: i + 1 })), now),
    audit(db, actor, 'create', id, { values: input.values.length }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Value names are unique within the request (the schema), so only the set's name can clash.
    if (isUniqueViolation(error)) throw optionSetNameTaken(input.name)
    throw error
  }
  return loadSet(db, id)
}

export async function renameOptionSet(db: Db, actor: Actor, id: string, input: RenameOptionSetInput): Promise<OptionSet> {
  await openSet(db, id, input.version)
  await runSetBatch(db, id, input.version, [
    repo.touchSetStatement(db, id, input.version, new Date(), { name: input.name }),
    requireOneChange(db),
    audit(db, actor, 'rename', id, {}),
  ], () => optionSetNameTaken(input.name))
  return loadSet(db, id)
}

/** Archiving hides the set from new use; its values and the item versions built on them stay. */
export async function archiveOptionSet(db: Db, actor: Actor, id: string, input: OptionVersionInput): Promise<OptionSet> {
  await openSet(db, id, input.version)
  await runSetBatch(db, id, input.version, [
    repo.touchSetStatement(db, id, input.version, new Date(), { status: 'archived' }),
    requireOneChange(db),
    audit(db, actor, 'archive', id, {}),
  ], () => optionSetChanged())
  return loadSet(db, id)
}

export async function restoreOptionSet(db: Db, actor: Actor, id: string, input: OptionVersionInput): Promise<OptionSet> {
  const set = await openSet(db, id, input.version, true)
  if (set.status !== 'archived') throw optionNotArchived('set')
  await runSetBatch(db, id, input.version, [
    repo.touchSetStatement(db, id, input.version, new Date(), { status: 'active' }, true),
    requireOneChange(db),
    audit(db, actor, 'restore', id, {}),
  ], () => optionSetNameTaken(set.name))
  return loadSet(db, id)
}

/** A new value at the end of the set. Existing items don't change (they price it when they want it). */
export async function addOptionValue(db: Db, actor: Actor, setId: string, input: AddOptionValueInput): Promise<OptionSet> {
  await openSet(db, setId, input.version)
  const values = await repo.valuesOf(db, [setId])
  if (values.filter(v => v.status === 'active').length >= MAX_OPTION_VALUES) throw tooManyOptionValues()
  const now = new Date()
  const valueId = newId()
  await runSetBatch(db, setId, input.version, [
    repo.touchSetStatement(db, setId, input.version, now),
    requireOneChange(db),
    repo.insertValuesStatement(db, [{ id: valueId, setId, name: input.name, sortOrder: await repo.nextValueOrder(db, setId) }], now),
    repo.requireActiveValueCount(db, setId, MAX_OPTION_VALUES),
    audit(db, actor, 'value.add', setId, { valueId }),
  ], () => optionValueNameTaken(input.name), () => tooManyOptionValues())
  return loadSet(db, setId)
}

export async function renameOptionValue(db: Db, actor: Actor, setId: string, valueId: string, input: RenameOptionValueInput): Promise<OptionSet> {
  await openSet(db, setId, input.version)
  const value = await openValue(db, setId, valueId)
  if (value.status !== 'active') throw optionValueArchived()
  const now = new Date()
  await runSetBatch(db, setId, input.version, [
    repo.touchSetStatement(db, setId, input.version, now),
    requireOneChange(db),
    repo.updateValueStatement(db, setId, valueId, { name: input.name }, now),
    audit(db, actor, 'value.rename', setId, { valueId }),
  ], () => optionValueNameTaken(input.name))
  return loadSet(db, setId)
}

/** Archiving a value hides the item versions that use it (step 3.5); a set keeps at least one. */
export async function archiveOptionValue(db: Db, actor: Actor, setId: string, valueId: string, input: OptionVersionInput): Promise<OptionSet> {
  await openSet(db, setId, input.version)
  const value = await openValue(db, setId, valueId)
  if (value.status !== 'active') throw optionValueArchived()
  const values = await repo.valuesOf(db, [setId])
  if (values.filter(v => v.status === 'active').length <= 1) throw lastOptionValue()
  const now = new Date()
  await runSetBatch(db, setId, input.version, [
    repo.touchSetStatement(db, setId, input.version, now),
    requireOneChange(db),
    repo.updateValueStatement(db, setId, valueId, { status: 'archived' }, now),
    repo.requireActiveValueCount(db, setId, MAX_OPTION_VALUES),
    audit(db, actor, 'value.archive', setId, { valueId }),
  ], () => optionSetChanged(), () => lastOptionValue())
  return loadSet(db, setId)
}

/** Restores a value at the end of the set. */
export async function restoreOptionValue(db: Db, actor: Actor, setId: string, valueId: string, input: OptionVersionInput): Promise<OptionSet> {
  await openSet(db, setId, input.version)
  const value = await openValue(db, setId, valueId)
  if (value.status !== 'archived') throw optionNotArchived('value')
  const values = await repo.valuesOf(db, [setId])
  if (values.filter(v => v.status === 'active').length >= MAX_OPTION_VALUES) throw tooManyOptionValues()
  const now = new Date()
  await runSetBatch(db, setId, input.version, [
    repo.touchSetStatement(db, setId, input.version, now),
    requireOneChange(db),
    repo.updateValueStatement(db, setId, valueId, { status: 'active', sortOrder: await repo.nextValueOrder(db, setId) }, now),
    repo.requireActiveValueCount(db, setId, MAX_OPTION_VALUES),
    audit(db, actor, 'value.restore', setId, { valueId }),
  ], () => optionValueNameTaken(value.name), () => tooManyOptionValues())
  return loadSet(db, setId)
}

/** Puts the set's active values in the given order; the list must be exactly those values. */
export async function reorderOptionValues(db: Db, actor: Actor, setId: string, input: ReorderOptionValuesInput): Promise<OptionSet> {
  await openSet(db, setId, input.version)
  const active = (await repo.valuesOf(db, [setId])).filter(v => v.status === 'active').map(v => v.id)
  if (active.length !== input.valueIds.length || input.valueIds.some(id => !active.includes(id))) throw optionValuesChanged()
  const now = new Date()
  await runSetBatch(db, setId, input.version, [
    repo.touchSetStatement(db, setId, input.version, now),
    requireOneChange(db),
    ...input.valueIds.map((valueId, i) => repo.updateValueStatement(db, setId, valueId, { sortOrder: i + 1 }, now)),
    audit(db, actor, 'value.reorder', setId, { order: input.valueIds }),
  ], () => optionSetChanged())
  return loadSet(db, setId)
}
