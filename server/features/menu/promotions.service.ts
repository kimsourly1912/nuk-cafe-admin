import type { CreatePromotionInput, Discount, Promotion, PromotionStatus, PromotionVersionInput, UpdatePromotionInput } from '#shared/contracts/menu-promotions'
import { discountLabel } from '#shared/contracts/menu-promotions'
import type { Db, Statement } from '#server/utils/batch'
import { isStaleWrite, requireOneChange } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { toIso } from '#server/utils/time'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { assetUrls, attachStatements, mediaNotAvailable, releaseStatement } from '#server/features/media'
import { cafeToday, listBranchOptions } from '#server/features/branches'
import { promotionChanged, promotionDatesPassed, promotionEnded, promotionNotDraft, promotionNotFound, promotionNotPublished, promotionTargetNotAvailable } from './promotions.errors'
import * as repo from './promotions.repository'
import type { PromotionLinks, PromotionRow, PromotionValues } from './promotions.repository'
import type { LivePromotion } from './promotions.rules'
import { promotionPhase } from './promotions.rules'

/**
 * Promotions (M1, D163): a discount on part of the menu, or all of it, between two dates. The
 * admin's library and its writes; the menu applies the running ones (`runningAt`, then
 * `applyPromotions`). `version` is the lock for the promotion and its links: the form saves them
 * together. Drafts are deleted; a published promotion is ended, and stays as it ran (orders name it).
 */

const discountOf = (row: Pick<PromotionRow, 'discountKind' | 'percent' | 'amountMinor'>): Discount =>
  row.discountKind === 'percent' ? { kind: 'percent', percent: row.percent! } : { kind: 'amount', amountMinor: row.amountMinor! }

function toPromotion(row: PromotionRow, links: PromotionLinks, posters: Map<string, string>, today: string): Promotion {
  const discount = discountOf(row)
  const posterUrl = row.posterAssetId ? posters.get(row.posterAssetId) : undefined
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    phase: promotionPhase(row, today),
    discount,
    label: discountLabel(discount),
    scope: row.scope,
    items: links.items.get(row.id) ?? [],
    categories: links.categories.get(row.id) ?? [],
    branches: links.branches.get(row.id) ?? [],
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    poster: row.posterAssetId && posterUrl ? { id: row.posterAssetId, url: posterUrl } : null,
    endedAt: row.endedAt ? toIso(row.endedAt) : null,
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

async function toPromotions(db: Db, tenantId: string, rows: PromotionRow[], now: Date): Promise<Promotion[]> {
  const [links, posters, today] = await Promise.all([
    repo.linksOf(db, tenantId, rows.map(row => row.id)),
    assetUrls(db, tenantId, rows.flatMap(row => row.posterAssetId ? [row.posterAssetId] : [])),
    cafeToday(db, tenantId, now),
  ])
  return rows.map(row => toPromotion(row, links, posters, today))
}

async function loadPromotion(db: Db, tenantId: string, id: string, now = new Date()): Promise<Promotion> {
  const row = await repo.findPromotion(db, tenantId, id)
  if (!row) throw promotionNotFound()
  return (await toPromotions(db, tenantId, [row], now))[0]!
}

/** The promotion, checked: the tenant's, at the version read, and not ended. */
async function openPromotion(db: Db, tenantId: string, id: string, version: number): Promise<PromotionRow> {
  const row = await repo.findPromotion(db, tenantId, id)
  if (!row) throw promotionNotFound()
  if (row.version !== version) throw promotionChanged()
  if (row.status === 'ended') throw promotionEnded()
  return row
}

type Fields = Omit<CreatePromotionInput, 'publish'>

/**
 * The links to save, checked: every newly chosen item still sells (not archived), every newly
 * chosen category is active, every newly chosen branch is active, all of this cafe's. What the
 * promotion already named may stay, archived or not (the database keeps them the tenant's).
 * The whole menu names no item or category.
 */
async function checkedLinks(db: Db, tenantId: string, input: Fields, current?: PromotionLinks & { id: string }) {
  const itemIds = input.scope === 'menu' ? [] : input.itemIds
  const categoryIds = input.scope === 'menu' ? [] : input.categoryIds
  const had = (list: Map<string, { id: string }[]> | undefined) => new Set((current && list?.get(current.id))?.map(ref => ref.id))
  const [oldItems, oldCategories, oldBranches] = [had(current?.items), had(current?.categories), had(current?.branches)]
  const newItems = itemIds.filter(id => !oldItems.has(id))
  const newCategories = categoryIds.filter(id => !oldCategories.has(id))
  const [liveItems, activeCategories, branches] = await Promise.all([
    repo.liveItemIds(db, tenantId, newItems),
    repo.activeCategoryIds(db, tenantId, newCategories),
    listBranchOptions(db, tenantId),
  ])
  const missingItem = itemIds.findIndex(id => !oldItems.has(id) && !liveItems.has(id))
  if (missingItem >= 0) throw promotionTargetNotAvailable('itemIds', missingItem)
  const missingCategory = categoryIds.findIndex(id => !oldCategories.has(id) && !activeCategories.has(id))
  if (missingCategory >= 0) throw promotionTargetNotAvailable('categoryIds', missingCategory)
  const activeBranches = new Set(branches.map(b => b.id))
  const missingBranch = input.branchIds.findIndex(id => !oldBranches.has(id) && !activeBranches.has(id))
  if (missingBranch >= 0) throw promotionTargetNotAvailable('branchIds', missingBranch)
  return { itemIds, categoryIds, branchIds: input.branchIds }
}

const valuesOf = (input: Fields): PromotionValues => ({
  name: input.name,
  description: input.description,
  discountKind: input.discount.kind,
  percent: input.discount.kind === 'percent' ? input.discount.percent : null,
  amountMinor: input.discount.kind === 'amount' ? input.discount.amountMinor : null,
  scope: input.scope,
  startsOn: input.startsOn,
  endsOn: input.endsOn,
  posterAssetId: input.posterId,
})

/** A published promotion must still have a day to run. */
async function checkRunsAgain(db: Db, tenantId: string, endsOn: string | null, now: Date) {
  if (endsOn !== null && endsOn < await cafeToday(db, tenantId, now)) throw promotionDatesPassed()
}

const audit = (db: Db, actor: Actor, action: string, id: string, metadata: Record<string, unknown>) =>
  auditStatement(db, actor, { action: `menu.promotion.${action}`, targetType: 'menu_promotion', targetId: id, metadata })

/**
 * Runs a write on one promotion (`target`: the one read, `null` when creating). A failed guard
 * is the promotion changed meanwhile (deleted, ended, or its version moved), or else the new
 * poster gone (`posterId`).
 */
async function runPromotionBatch(db: Db, tenantId: string, target: { id: string, version: number } | null, statements: Statement[], posterId?: string | null) {
  try {
    await db.batch(statements as [Statement, ...Statement[]])
  }
  catch (error) {
    if (!isStaleWrite(error)) throw error
    if (target) {
      const current = await repo.findPromotion(db, tenantId, target.id)
      if (!current) throw promotionNotFound()
      if (current.status === 'ended') throw promotionEnded()
      if (current.version !== target.version) throw promotionChanged()
    }
    throw posterId ? mediaNotAvailable('posterId') : promotionChanged()
  }
}

export async function listPromotions(db: Db, tenantId: string, now = new Date()): Promise<Promotion[]> {
  return toPromotions(db, tenantId, await repo.listPromotions(db, tenantId), now)
}

export function getPromotion(db: Db, tenantId: string, id: string, now = new Date()): Promise<Promotion> {
  return loadPromotion(db, tenantId, id, now)
}

export async function createPromotion(db: Db, actor: Actor, input: CreatePromotionInput, now = new Date()): Promise<Promotion> {
  const { publish, ...fields } = input
  const links = await checkedLinks(db, actor.tenantId, fields)
  if (publish) await checkRunsAgain(db, actor.tenantId, fields.endsOn, now)
  const id = newId()
  const status: PromotionStatus = publish ? 'published' : 'draft'
  await runPromotionBatch(db, actor.tenantId, null, [
    repo.insertPromotionStatement(db, { id, tenantId: actor.tenantId, status, now, ...valuesOf(fields) }),
    ...repo.replaceLinksStatements(db, actor.tenantId, id, links),
    ...(fields.posterId ? await attachStatements(db, actor.tenantId, fields.posterId, 'posterId') : []),
    audit(db, actor, 'create', id, { status, discount: fields.discount, scope: fields.scope, startsOn: fields.startsOn, endsOn: fields.endsOn }),
  ], fields.posterId)
  return loadPromotion(db, actor.tenantId, id, now)
}

/**
 * Replaces a draft or published promotion (an ended one stays as it ran). `publish` publishes a
 * draft in the same write. The menu shows the new prices at once; a checkout that saw the old ones
 * is told the prices changed (D99).
 */
export async function updatePromotion(db: Db, actor: Actor, id: string, input: UpdatePromotionInput, now = new Date()): Promise<Promotion> {
  const { publish, version, ...fields } = input
  const current = await openPromotion(db, actor.tenantId, id, version)
  const links = await checkedLinks(db, actor.tenantId, fields, { id, ...await repo.linksOf(db, actor.tenantId, [id]) })
  const status: PromotionStatus = current.status === 'draft' && !publish ? 'draft' : 'published'
  if (status === 'published') await checkRunsAgain(db, actor.tenantId, fields.endsOn, now)
  const posterChanging = fields.posterId !== current.posterAssetId
  await runPromotionBatch(db, actor.tenantId, { id, version }, [
    repo.touchPromotionStatement(db, actor.tenantId, id, version, [current.status], now, { ...valuesOf(fields), status }),
    requireOneChange(db),
    ...repo.replaceLinksStatements(db, actor.tenantId, id, links),
    ...(posterChanging && current.posterAssetId ? [releaseStatement(db, actor.tenantId, current.posterAssetId)] : []),
    ...(posterChanging && fields.posterId ? await attachStatements(db, actor.tenantId, fields.posterId, 'posterId') : []),
    audit(db, actor, status !== current.status ? 'publish' : 'update', id, { discount: fields.discount, scope: fields.scope, startsOn: fields.startsOn, endsOn: fields.endsOn }),
  ], posterChanging ? fields.posterId : undefined)
  return loadPromotion(db, actor.tenantId, id, now)
}

/** A draft goes live on its start date (at once if that's today or earlier). */
export async function publishPromotion(db: Db, actor: Actor, id: string, input: PromotionVersionInput, now = new Date()): Promise<Promotion> {
  const current = await openPromotion(db, actor.tenantId, id, input.version)
  if (current.status !== 'draft') return loadPromotion(db, actor.tenantId, id, now)
  await checkRunsAgain(db, actor.tenantId, current.endsOn, now)
  await runPromotionBatch(db, actor.tenantId, { id, version: input.version }, [
    repo.touchPromotionStatement(db, actor.tenantId, id, input.version, ['draft'], now, { status: 'published' }),
    requireOneChange(db),
    audit(db, actor, 'publish', id, {}),
  ])
  return loadPromotion(db, actor.tenantId, id, now)
}

/** Stops a published promotion now (scheduled or live): prices go back at once. */
export async function endPromotion(db: Db, actor: Actor, id: string, input: PromotionVersionInput, now = new Date()): Promise<Promotion> {
  const current = await openPromotion(db, actor.tenantId, id, input.version)
  if (current.status !== 'published') throw promotionNotPublished()
  await runPromotionBatch(db, actor.tenantId, { id, version: input.version }, [
    repo.touchPromotionStatement(db, actor.tenantId, id, input.version, ['published'], now, { status: 'ended', endedAt: now }),
    requireOneChange(db),
    audit(db, actor, 'end', id, {}),
  ])
  return loadPromotion(db, actor.tenantId, id, now)
}

/** Deletes a draft (no customer ever saw it); its poster is released. */
export async function deletePromotion(db: Db, actor: Actor, id: string, input: PromotionVersionInput): Promise<void> {
  const current = await openPromotion(db, actor.tenantId, id, input.version)
  if (current.status !== 'draft') throw promotionNotDraft()
  await runPromotionBatch(db, actor.tenantId, { id, version: input.version }, [
    repo.deleteDraftStatement(db, actor.tenantId, id, input.version),
    requireOneChange(db),
    ...(current.posterAssetId ? [releaseStatement(db, actor.tenantId, current.posterAssetId)] : []),
    audit(db, actor, 'delete', id, { name: current.name }),
  ])
}

/** The promotions running at `branchId` on `today` (that branch's date), as pricing needs them. */
export async function runningAt(db: Db, tenantId: string, branchId: string, today: string): Promise<LivePromotion[]> {
  const rows = await repo.runningPromotions(db, tenantId, branchId, today)
  if (!rows.length) return []
  const ids = rows.map(row => row.id)
  const [targets, posters] = await Promise.all([
    repo.targetIdsOf(db, tenantId, ids),
    assetUrls(db, tenantId, rows.flatMap(row => row.posterAssetId ? [row.posterAssetId] : [])),
  ])
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    discount: discountOf(row),
    scope: row.scope,
    itemIds: new Set(targets.items.get(row.id)),
    categoryIds: new Set(targets.categories.get(row.id)),
    endsOn: row.endsOn,
    posterUrl: row.posterAssetId ? posters.get(row.posterAssetId) ?? null : null,
  }))
}
