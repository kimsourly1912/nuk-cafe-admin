import type { AddModifierInput, CreateModifierGroupInput, ModifierGroup, ModifierGroupListQuery, ModifierVersionInput, ReorderModifiersInput, UpdateModifierGroupInput, UpdateModifierInput } from '#shared/contracts/menu-modifiers'
import type { Db, Statement } from '../../utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { toIso } from '../../utils/time'
import type { Actor } from '../identity'
import { auditStatement } from '../platform'
import { itemCountsByGroup } from './items.repository'
import { modifierArchived, modifierGroupArchived, modifierGroupChanged, modifierGroupNameTaken, modifierGroupNotFound, modifierNameTaken, modifierNotArchived, modifierNotFound, modifiersChanged, selectionRules } from './modifiers.errors'
import * as repo from './modifiers.repository'
import type { ModifierGroupRow, ModifierRow } from './modifiers.repository'
import type { SelectionState } from './modifiers.rules'
import { selectionProblem } from './modifiers.rules'

/**
 * The Add-ons library (docs/server/data-model.md → Menu, D44, D59). Same shape as the Options
 * library (D58): the group's `version` locks the group and its add-ons. Every change is checked
 * against the selection rules twice: before writing, for a precise message, and in the batch,
 * against whatever changed in between.
 */

function toGroup(row: ModifierGroupRow, modifiers: ModifierRow[], itemCounts: Map<string, number>): ModifierGroup {
  const own = modifiers.filter(m => m.groupId === row.id)
  return {
    id: row.id,
    name: row.name,
    minSelect: row.minSelect,
    maxSelect: row.maxSelect,
    status: row.status,
    modifiers: [...own.filter(m => m.status === 'active'), ...own.filter(m => m.status !== 'active')]
      .map(m => ({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor, isDefault: m.isDefault, sortOrder: m.sortOrder, status: m.status })),
    itemCount: itemCounts.get(row.id) ?? 0,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function loadGroup(db: Db, id: string): Promise<ModifierGroup> {
  const row = await repo.findGroup(db, id)
  if (!row) throw modifierGroupNotFound()
  return toGroup(row, await repo.modifiersOf(db, [id]), await itemCountsByGroup(db, [id]))
}

async function openGroup(db: Db, id: string, version: number, allowArchived = false): Promise<ModifierGroupRow> {
  const group = await repo.findGroup(db, id)
  if (!group) throw modifierGroupNotFound()
  if (group.version !== version) throw modifierGroupChanged()
  if (!allowArchived && group.status !== 'active') throw modifierGroupArchived()
  return group
}

async function openModifier(db: Db, groupId: string, modifierId: string): Promise<ModifierRow> {
  const modifier = await repo.findModifier(db, groupId, modifierId)
  if (!modifier) throw modifierNotFound()
  return modifier
}

/** The rules as they would be after the change. */
async function currentState(db: Db, group: Pick<ModifierGroupRow, 'id' | 'minSelect' | 'maxSelect'>): Promise<SelectionState> {
  const active = (await repo.modifiersOf(db, [group.id])).filter(m => m.status === 'active')
  return { minSelect: group.minSelect, maxSelect: group.maxSelect, active: active.length, defaults: active.filter(m => m.isDefault).length }
}

function ensureSelection(state: SelectionState) {
  const problem = selectionProblem(state)
  if (problem) throw selectionRules(problem)
}

const RULES_CHANGED = { field: 'modifiers', message: 'The add-ons changed while saving, so the selection rules no longer fit. Reload the group and try again.' }

const audit = (db: Db, actor: Actor, action: string, groupId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `menu.modifier_group.${action}`, targetType: 'menu_modifier_group', targetId: groupId, metadata })

/**
 * Runs a write on one group. A unique-index failure is `onNameTaken()`. A failed guard is either the
 * group changed meanwhile (its version moved) or the selection rules no longer fit.
 */
async function runGroupBatch(db: Db, groupId: string, version: number, statements: Statement[], onNameTaken: () => Error) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw onNameTaken()
    if (!isStaleWrite(error)) throw error
    const current = await repo.findGroup(db, groupId)
    throw current?.version === version ? selectionRules(RULES_CHANGED) : modifierGroupChanged()
  }
}

export async function listModifierGroups(db: Db, query: ModifierGroupListQuery): Promise<ModifierGroup[]> {
  const groups = await repo.listGroups(db, query.status)
  const ids = groups.map(g => g.id)
  const [modifiers, itemCounts] = await Promise.all([repo.modifiersOf(db, ids), itemCountsByGroup(db, ids)])
  return groups.map(group => toGroup(group, modifiers, itemCounts))
}

export async function getModifierGroup(db: Db, id: string): Promise<ModifierGroup> {
  return loadGroup(db, id)
}

export async function createModifierGroup(db: Db, actor: Actor, input: CreateModifierGroupInput): Promise<ModifierGroup> {
  ensureSelection({ minSelect: input.minSelect, maxSelect: input.maxSelect, active: input.modifiers.length, defaults: input.modifiers.filter(m => m.isDefault).length })
  const id = newId()
  const now = new Date()
  const statements: Statement[] = [
    repo.insertGroupStatement(db, { id, name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, now }),
    ...repo.insertModifiersStatements(db, input.modifiers.map((m, i) => ({ id: newId(), groupId: id, name: m.name, priceDeltaMinor: m.priceDeltaMinor, isDefault: m.isDefault, sortOrder: i + 1 })), now),
    audit(db, actor, 'create', id, { modifiers: input.modifiers.length }),
  ]
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    // Add-on names are unique within the request (the schema), so only the group's name can clash.
    if (isUniqueViolation(error)) throw modifierGroupNameTaken(input.name)
    throw error
  }
  return loadGroup(db, id)
}

/** Renames the group or changes its selection rules (checked against its active add-ons). */
export async function updateModifierGroup(db: Db, actor: Actor, id: string, input: UpdateModifierGroupInput): Promise<ModifierGroup> {
  const group = await openGroup(db, id, input.version)
  const changes = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.minSelect !== undefined && { minSelect: input.minSelect }),
    ...(input.maxSelect !== undefined && { maxSelect: input.maxSelect }),
  }
  ensureSelection(await currentState(db, { ...group, ...changes }))
  await runGroupBatch(db, id, input.version, [
    repo.touchGroupStatement(db, id, input.version, new Date(), changes),
    requireOneChange(db),
    repo.requireSelectionRules(db, id),
    audit(db, actor, 'update', id, { fields: Object.keys(changes) }),
  ], () => modifierGroupNameTaken(input.name ?? group.name))
  return loadGroup(db, id)
}

export async function archiveModifierGroup(db: Db, actor: Actor, id: string, input: ModifierVersionInput): Promise<ModifierGroup> {
  await openGroup(db, id, input.version)
  await runGroupBatch(db, id, input.version, [
    repo.touchGroupStatement(db, id, input.version, new Date(), { status: 'archived' }),
    requireOneChange(db),
    audit(db, actor, 'archive', id, {}),
  ], () => modifierGroupChanged())
  return loadGroup(db, id)
}

export async function restoreModifierGroup(db: Db, actor: Actor, id: string, input: ModifierVersionInput): Promise<ModifierGroup> {
  const group = await openGroup(db, id, input.version, true)
  if (group.status !== 'archived') throw modifierNotArchived('group')
  await runGroupBatch(db, id, input.version, [
    repo.touchGroupStatement(db, id, input.version, new Date(), { status: 'active' }, true),
    requireOneChange(db),
    audit(db, actor, 'restore', id, {}),
  ], () => modifierGroupNameTaken(group.name))
  return loadGroup(db, id)
}

export async function addModifier(db: Db, actor: Actor, groupId: string, input: AddModifierInput): Promise<ModifierGroup> {
  const group = await openGroup(db, groupId, input.version)
  const state = await currentState(db, group)
  ensureSelection({ ...state, active: state.active + 1, defaults: state.defaults + (input.isDefault ? 1 : 0) })
  const now = new Date()
  const modifierId = newId()
  await runGroupBatch(db, groupId, input.version, [
    repo.touchGroupStatement(db, groupId, input.version, now),
    requireOneChange(db),
    ...repo.insertModifiersStatements(db, [{ id: modifierId, groupId, name: input.name, priceDeltaMinor: input.priceDeltaMinor, isDefault: input.isDefault, sortOrder: await repo.nextModifierOrder(db, groupId) }], now),
    repo.requireSelectionRules(db, groupId),
    audit(db, actor, 'modifier.add', groupId, { modifierId, priceDeltaMinor: input.priceDeltaMinor }),
  ], () => modifierNameTaken(input.name))
  return loadGroup(db, groupId)
}

/** Renames an add-on, changes its default price, or whether it's pre-selected. */
export async function updateModifier(db: Db, actor: Actor, groupId: string, modifierId: string, input: UpdateModifierInput): Promise<ModifierGroup> {
  const group = await openGroup(db, groupId, input.version)
  const modifier = await openModifier(db, groupId, modifierId)
  if (modifier.status !== 'active') throw modifierArchived()
  const changes = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.priceDeltaMinor !== undefined && { priceDeltaMinor: input.priceDeltaMinor }),
    ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
  }
  const state = await currentState(db, group)
  ensureSelection({ ...state, defaults: state.defaults - (modifier.isDefault ? 1 : 0) + ((changes.isDefault ?? modifier.isDefault) ? 1 : 0) })
  const now = new Date()
  await runGroupBatch(db, groupId, input.version, [
    repo.touchGroupStatement(db, groupId, input.version, now),
    requireOneChange(db),
    repo.updateModifierStatement(db, groupId, modifierId, changes, now),
    repo.requireSelectionRules(db, groupId),
    audit(db, actor, 'modifier.update', groupId, { modifierId, fields: Object.keys(changes), ...(changes.priceDeltaMinor !== undefined && { from: modifier.priceDeltaMinor, to: changes.priceDeltaMinor }) }),
  ], () => modifierNameTaken(input.name ?? modifier.name))
  return loadGroup(db, groupId)
}

export async function archiveModifier(db: Db, actor: Actor, groupId: string, modifierId: string, input: ModifierVersionInput): Promise<ModifierGroup> {
  const group = await openGroup(db, groupId, input.version)
  const modifier = await openModifier(db, groupId, modifierId)
  if (modifier.status !== 'active') throw modifierArchived()
  const state = await currentState(db, group)
  ensureSelection({ ...state, active: state.active - 1, defaults: state.defaults - (modifier.isDefault ? 1 : 0) })
  const now = new Date()
  await runGroupBatch(db, groupId, input.version, [
    repo.touchGroupStatement(db, groupId, input.version, now),
    requireOneChange(db),
    repo.updateModifierStatement(db, groupId, modifierId, { status: 'archived' }, now),
    repo.requireSelectionRules(db, groupId),
    audit(db, actor, 'modifier.archive', groupId, { modifierId }),
  ], () => modifierGroupChanged())
  return loadGroup(db, groupId)
}

/** Restores an add-on at the end of the group. */
export async function restoreModifier(db: Db, actor: Actor, groupId: string, modifierId: string, input: ModifierVersionInput): Promise<ModifierGroup> {
  const group = await openGroup(db, groupId, input.version)
  const modifier = await openModifier(db, groupId, modifierId)
  if (modifier.status !== 'archived') throw modifierNotArchived('add-on')
  const state = await currentState(db, group)
  ensureSelection({ ...state, active: state.active + 1, defaults: state.defaults + (modifier.isDefault ? 1 : 0) })
  const now = new Date()
  await runGroupBatch(db, groupId, input.version, [
    repo.touchGroupStatement(db, groupId, input.version, now),
    requireOneChange(db),
    repo.updateModifierStatement(db, groupId, modifierId, { status: 'active', sortOrder: await repo.nextModifierOrder(db, groupId) }, now),
    repo.requireSelectionRules(db, groupId),
    audit(db, actor, 'modifier.restore', groupId, { modifierId }),
  ], () => modifierNameTaken(modifier.name))
  return loadGroup(db, groupId)
}

export async function reorderModifiers(db: Db, actor: Actor, groupId: string, input: ReorderModifiersInput): Promise<ModifierGroup> {
  await openGroup(db, groupId, input.version)
  const active = (await repo.modifiersOf(db, [groupId])).filter(m => m.status === 'active').map(m => m.id)
  if (active.length !== input.modifierIds.length || input.modifierIds.some(id => !active.includes(id))) throw modifiersChanged()
  const now = new Date()
  await runGroupBatch(db, groupId, input.version, [
    repo.touchGroupStatement(db, groupId, input.version, now),
    requireOneChange(db),
    ...input.modifierIds.map((modifierId, i) => repo.updateModifierStatement(db, groupId, modifierId, { sortOrder: i + 1 }, now)),
    audit(db, actor, 'modifier.reorder', groupId, { order: input.modifierIds }),
  ], () => modifierGroupChanged())
  return loadGroup(db, groupId)
}
