import type { AvailabilityRule, AvailabilityRuleListQuery, AvailabilityRuleVersionInput, AvailabilityWindow, CreateAvailabilityRuleInput, UpdateAvailabilityRuleInput } from '#shared/contracts/menu-availability'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, isUniqueViolation, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { availabilityRuleArchived, availabilityRuleChanged, availabilityRuleInUse, availabilityRuleNameTaken, availabilityRuleNotArchived, availabilityRuleNotAvailable, availabilityRuleNotFound, availabilityWindows } from './availability.errors'
import * as repo from './availability.repository'
import type { RuleRow } from './availability.repository'
import { sortWindows, windowsProblem } from './availability.rules'

/**
 * Availability rules (docs/server/data-model.md → Menu, D45, D63): a library of named weekly
 * windows. Items and categories choose theirs in their own forms (see `planRuleLinks`). The rule's
 * `version` is the lock for the rule and its windows.
 */

function toRule(row: RuleRow, windows: Map<string, AvailabilityWindow[]>, usage: Awaited<ReturnType<typeof repo.usageCounts>>): AvailabilityRule {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    windows: windows.get(row.id) ?? [],
    itemCount: usage.items.get(row.id) ?? 0,
    categoryCount: usage.categories.get(row.id) ?? 0,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function loadRule(db: Db, tenantId: string, id: string): Promise<AvailabilityRule> {
  const row = await repo.findRule(db, tenantId, id)
  if (!row) throw availabilityRuleNotFound()
  const [windows, usage] = await Promise.all([repo.windowsOf(db, [id]), repo.usageCounts(db, [id])])
  return toRule(row, windows, usage)
}

/** The rule, checked: exists, at the version read, and active (unless restoring). */
async function openRule(db: Db, tenantId: string, id: string, version: number, allowArchived = false): Promise<RuleRow> {
  const rule = await repo.findRule(db, tenantId, id)
  if (!rule) throw availabilityRuleNotFound()
  if (rule.version !== version) throw availabilityRuleChanged()
  if (!allowArchived && rule.status !== 'active') throw availabilityRuleArchived()
  return rule
}

/** The windows in listing order, refused when two overlap. */
function checkedWindows(windows: AvailabilityWindow[]): AvailabilityWindow[] {
  const problem = windowsProblem(windows)
  if (problem) throw availabilityWindows(problem)
  return sortWindows(windows)
}

const audit = (db: Db, actor: Actor, action: string, ruleId: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `menu.availability_rule.${action}`, targetType: 'menu_availability_rule', targetId: ruleId, metadata })

/**
 * Runs a write on one rule. A unique-index failure is `onNameTaken()`. A failed guard is either the
 * rule changed meanwhile (its version moved) or `onGuard()`.
 */
async function runRuleBatch(db: Db, tenantId: string, ruleId: string, version: number, statements: Statement[], onNameTaken: () => Error, onGuard: () => Promise<Error> = async () => availabilityRuleChanged()) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (isUniqueViolation(error)) throw onNameTaken()
    if (!isStaleWrite(error)) throw error
    const current = await repo.findRule(db, tenantId, ruleId)
    throw current?.version === version ? await onGuard() : availabilityRuleChanged()
  }
}

export async function listAvailabilityRules(db: Db, tenantId: string, query: AvailabilityRuleListQuery): Promise<AvailabilityRule[]> {
  const rules = await repo.listRules(db, tenantId, query.status)
  const ids = rules.map(r => r.id)
  const [windows, usage] = await Promise.all([repo.windowsOf(db, ids), repo.usageCounts(db, ids)])
  return rules.map(rule => toRule(rule, windows, usage))
}

export async function getAvailabilityRule(db: Db, tenantId: string, id: string): Promise<AvailabilityRule> {
  return loadRule(db, tenantId, id)
}

export async function createAvailabilityRule(db: Db, actor: Actor, input: CreateAvailabilityRuleInput): Promise<AvailabilityRule> {
  const windows = checkedWindows(input.windows)
  const id = newId()
  const now = new Date()
  try {
    await db.batch([
      repo.insertRuleStatement(db, { id, tenantId: actor.tenantId, name: input.name, now }),
      ...repo.replaceWindowsStatements(db, actor.tenantId, id, windows),
      audit(db, actor, 'create', id, { windows }),
    ] as [Statement, ...Statement[]])
  }
  catch (error) {
    // Windows don't overlap (checked above), so only the name can clash.
    if (isUniqueViolation(error)) throw availabilityRuleNameTaken(input.name)
    throw error
  }
  return loadRule(db, actor.tenantId, id)
}

/** Renames the rule and/or replaces its windows. Items and categories using it follow at once. */
export async function updateAvailabilityRule(db: Db, actor: Actor, id: string, input: UpdateAvailabilityRuleInput): Promise<AvailabilityRule> {
  const current = await openRule(db, actor.tenantId, id, input.version)
  const windows = input.windows && checkedWindows(input.windows)
  const before = windows && (await repo.windowsOf(db, [id])).get(id)
  await runRuleBatch(db, actor.tenantId, id, input.version, [
    repo.touchRuleStatement(db, actor.tenantId, id, input.version, new Date(), input.name === undefined ? {} : { name: input.name }),
    requireOneChange(db),
    ...(windows ? repo.replaceWindowsStatements(db, actor.tenantId, id, windows) : []),
    audit(db, actor, 'update', id, {
      ...(input.name !== undefined && input.name !== current.name && { name: { from: current.name, to: input.name } }),
      ...(windows && { windows: { from: before ?? [], to: windows } }),
    }),
  ], () => availabilityRuleNameTaken(input.name ?? current.name))
  return loadRule(db, actor.tenantId, id)
}

/**
 * Archives an unused rule. A rule that drafts, active items or active categories use can't be
 * archived: an archived rule never matches, so they'd silently stop selling (D63).
 */
export async function archiveAvailabilityRule(db: Db, actor: Actor, id: string, input: AvailabilityRuleVersionInput): Promise<AvailabilityRule> {
  await openRule(db, actor.tenantId, id, input.version)
  const inUse = async () => {
    const usage = await repo.usageCounts(db, [id])
    return availabilityRuleInUse(usage.items.get(id) ?? 0, usage.categories.get(id) ?? 0)
  }
  const usage = await repo.usageCounts(db, [id])
  if (usage.items.has(id) || usage.categories.has(id)) throw await inUse()
  await runRuleBatch(db, actor.tenantId, id, input.version, [
    repo.touchRuleStatement(db, actor.tenantId, id, input.version, new Date(), { status: 'archived' }),
    requireOneChange(db),
    repo.requireRuleUnused(db, id),
    audit(db, actor, 'archive', id, {}),
  ], () => availabilityRuleChanged(), inUse)
  return loadRule(db, actor.tenantId, id)
}

export async function restoreAvailabilityRule(db: Db, actor: Actor, id: string, input: AvailabilityRuleVersionInput): Promise<AvailabilityRule> {
  const rule = await openRule(db, actor.tenantId, id, input.version, true)
  if (rule.status !== 'archived') throw availabilityRuleNotArchived()
  await runRuleBatch(db, actor.tenantId, id, input.version, [
    repo.touchRuleStatement(db, actor.tenantId, id, input.version, new Date(), { status: 'active' }, true),
    requireOneChange(db),
    audit(db, actor, 'restore', id, {}),
  ], () => availabilityRuleNameTaken(rule.name))
  return loadRule(db, actor.tenantId, id)
}

// --- Used by the item and category writes ---

/**
 * Checks the rules an item or category is about to use. A rule newly chosen must be active; one it
 * already uses may stay after being archived (so a form can send back what it read). Returns the
 * newly chosen ones: the write guards them with `repo.requireActiveRules` in its batch.
 */
export async function planRuleLinks(db: Db, tenantId: string, ruleIds: string[], currentIds: string[] = []): Promise<string[]> {
  const rules = await repo.findRefs(db, tenantId, ruleIds)
  const added = ruleIds.filter(id => !currentIds.includes(id))
  ruleIds.forEach((id, i) => {
    const rule = rules.find(r => r.id === id)
    if (!rule || (rule.status !== 'active' && added.includes(id))) throw availabilityRuleNotAvailable(i)
  })
  return added
}

/**
 * After a write's batch failed: the error for a newly chosen rule archived meanwhile, if that's
 * what happened.
 */
export async function ruleLinksFailure(db: Db, tenantId: string, ruleIds: string[], added: string[]): Promise<Error | undefined> {
  if (!added.length) return undefined
  const rules = await repo.findRefs(db, tenantId, added)
  const index = ruleIds.findIndex(id => added.includes(id) && rules.find(r => r.id === id)?.status !== 'active')
  return index >= 0 ? availabilityRuleNotAvailable(index) : undefined
}
