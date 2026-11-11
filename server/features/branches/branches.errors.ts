import { MAX_BRANCH_TABLES, MAX_BRANCHES } from '#shared/contracts/branches'
import { MAX_CUSTOM_ITEM_LOOKS, MAX_CUSTOM_LOOKS } from '#shared/contracts/shop-layout'
import { apiError, ErrorCodes, notFound, versionConflict } from '#server/utils/errors'

export const BranchErrorCodes = {
  BRANCH_HOURS: 'BRANCH_HOURS',
  BRANCH_LIMIT: 'BRANCH_LIMIT',
  BRANCH_CLOSED: 'BRANCH_CLOSED',
  BRANCH_NAME_TAKEN: 'BRANCH_NAME_TAKEN',
  UNKNOWN_TIMEZONE: 'UNKNOWN_TIMEZONE',
  TABLE_LABEL_TAKEN: 'TABLE_LABEL_TAKEN',
  TABLE_LIMIT: 'TABLE_LIMIT',
  QR_NOT_CONFIGURED: 'QR_NOT_CONFIGURED',
  TABLE_HAS_ORDERS: 'TABLE_HAS_ORDERS',
  LAYOUT_TABLE_UNAVAILABLE: 'LAYOUT_TABLE_UNAVAILABLE',
  LAYOUT_LOOK_UNAVAILABLE: 'LAYOUT_LOOK_UNAVAILABLE',
  LOOK_NAME_TAKEN: 'LOOK_NAME_TAKEN',
  LOOK_LIMIT: 'LOOK_LIMIT',
  LOOK_IN_USE: 'LOOK_IN_USE',
} as const

export const branchNotFound = () => notFound('This branch')

export const branchChanged = () => versionConflict('This branch')

export const branchArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This branch is archived.')

export const branchLimit = () =>
  apiError(409, BranchErrorCodes.BRANCH_LIMIT, `A cafe can have at most ${MAX_BRANCHES} branches.`)

/** Pausing a branch that's closed now (D199): nothing to pause until it opens. */
export const branchClosedNow = (name: string) =>
  apiError(409, BranchErrorCodes.BRANCH_CLOSED, `${name} is closed now: there are no orders to pause.`)

export const branchNameTaken = (name: string) =>
  apiError(409, BranchErrorCodes.BRANCH_NAME_TAKEN, `There is already a branch named "${name}".`, {
    fieldErrors: { name: ['Already used by another branch'] },
  })

/** Overlapping opening windows (the contract checks each window on its own). */
export const branchHoursProblem = (problem: { field: string, message: string }) =>
  apiError(422, BranchErrorCodes.BRANCH_HOURS, problem.message, { fieldErrors: { [problem.field]: [problem.message] } })

export const unknownTimezone = (timezone: string) =>
  apiError(422, BranchErrorCodes.UNKNOWN_TIMEZONE, `"${timezone}" isn't a time zone.`, {
    fieldErrors: { timezone: ['Choose a time zone from the list'] },
  })

export const tableNotFound = () => notFound('This table')

export const tableChanged = () => versionConflict('This table')

export const tableLabelTaken = (label: string) =>
  apiError(409, BranchErrorCodes.TABLE_LABEL_TAKEN, `There is already a table named "${label}" in this branch.`, {
    fieldErrors: { label: ['Already used by another table'] },
  })

export const tableLimit = () =>
  apiError(409, BranchErrorCodes.TABLE_LIMIT, `A branch can have at most ${MAX_BRANCH_TABLES} tables, archived ones included.`)

export const tableArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This table is archived. Restore it first.')

export const tableNotArchived = (message = 'This table isn\'t archived.') =>
  apiError(409, ErrorCodes.INVALID_STATE, message)

/** A permanent delete of a table orders were placed at (D200): it stays archived. */
export const tableHasOrders = () =>
  apiError(409, BranchErrorCodes.TABLE_HAS_ORDERS, 'Orders were placed at this table, so it stays archived to keep your order history.')

export const layoutChanged = () => versionConflict('This shop layout')

/**
 * A save places tables that aren't active tables of this branch any more (archived or deleted
 * meanwhile), or never were. Named by their place in the save, not by label: an id from elsewhere
 * says nothing about another branch's tables.
 */
export const layoutTablesUnavailable = (positions: number[]) =>
  apiError(409, BranchErrorCodes.LAYOUT_TABLE_UNAVAILABLE, positions.length === 1
    ? 'A table on this plan was archived or removed meanwhile. Take it off the plan and save again.'
    : `${positions.length} tables on this plan were archived or removed meanwhile. Take them off the plan and save again.`, {
    fieldErrors: Object.fromEntries(positions.map(index => [`layout.placements.${index}.tableId`, ['Archived or removed meanwhile']])),
  })

/**
 * A save gives tables or furniture a look that isn't a built-in one or one of this cafe's own
 * (deleted meanwhile, another cafe's, or a chair look on a counter). `fields` are the `lookId`
 * paths of the save (`layout.placements.<i>.lookId`, `layout.floors.<f>.items.<i>.lookId`): named
 * by their place in the save, like the tables above.
 */
export function layoutLooksUnavailable(fields: string[]) {
  const tables = fields.filter(field => field.startsWith('layout.placements.')).length
  const pieces = fields.length - tables
  const named = [
    tables && (tables === 1 ? 'a table' : `${tables} tables`),
    pieces && (pieces === 1 ? 'a piece of furniture' : `${pieces} pieces of furniture`),
  ].filter(Boolean).join(' and ')
  const subject = named.charAt(0).toUpperCase() + named.slice(1)
  const one = fields.length === 1
  return apiError(409, BranchErrorCodes.LAYOUT_LOOK_UNAVAILABLE, `${subject} on this plan ${one ? 'uses' : 'use'} a look that was deleted. Choose another look for ${one ? 'it' : 'them'} and save again.`, {
    fieldErrors: Object.fromEntries(fields.map(field => [field, ['This look was deleted']])),
  })
}

export const lookNotFound = () => notFound('This look')

export const lookChanged = () => versionConflict('This look')

export const lookNameTaken = (name: string) =>
  apiError(409, BranchErrorCodes.LOOK_NAME_TAKEN, `There is already a look named "${name}".`, {
    fieldErrors: { name: ['Already used by another look'] },
  })

export const lookLimit = () =>
  apiError(409, BranchErrorCodes.LOOK_LIMIT, `A cafe can have at most ${MAX_CUSTOM_LOOKS} custom looks. Delete one you don't use first.`)

/** A delete of a look placed tables still use: `tables` are some of them, `total` all. */
export function lookInUse(tables: { label: string, branch: string }[], total: number) {
  const names = tables.map(table => `${table.label} (${table.branch})`).join(', ')
  const more = total - tables.length
  return apiError(409, BranchErrorCodes.LOOK_IN_USE, `This look is used by ${names}${more > 0 ? ` and ${more} more` : ''}. Give ${total === 1 ? 'that table' : 'those tables'} another look first.`)
}

export const itemLookNotFound = () => notFound('This look')

export const itemLookChanged = () => versionConflict('This look')

export const itemLookNameTaken = (name: string) =>
  apiError(409, BranchErrorCodes.LOOK_NAME_TAKEN, `There is already a chair or fixture look named "${name}".`, {
    fieldErrors: { name: ['Already used by another look'] },
  })

export const itemLookLimit = () =>
  apiError(409, BranchErrorCodes.LOOK_LIMIT, `A cafe can have at most ${MAX_CUSTOM_ITEM_LOOKS} chair and fixture looks. Delete one you don't use first.`)

/** A delete of a chair or fixture look placed pieces still use: `places` are some of its floors, `total` all its pieces. */
export function itemLookInUse(places: { floor: string, branch: string, pieces: number }[], total: number) {
  const named = places.map(place => `${place.pieces} on the ${place.floor} floor (${place.branch})`).join(', ')
  const more = total - places.reduce((sum, place) => sum + place.pieces, 0)
  return apiError(409, BranchErrorCodes.LOOK_IN_USE, `This look is used by ${total === 1 ? '1 piece' : `${total} pieces`}: ${named}${more > 0 ? ` and ${more} more` : ''}. Give ${total === 1 ? 'it' : 'them'} another look first.`)
}

/** A deployed server without `NUXT_QR_SECRET` (docs/server/operations.md → Configuration). */
export const qrNotConfigured = () =>
  apiError(500, BranchErrorCodes.QR_NOT_CONFIGURED, 'Table QR codes aren\'t set up on this server yet.')
