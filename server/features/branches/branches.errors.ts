import { MAX_BRANCH_TABLES } from '#shared/contracts/branches'
import { apiError, ErrorCodes, notFound, versionConflict } from '../../utils/errors'

export const BranchErrorCodes = {
  BRANCH_HOURS: 'BRANCH_HOURS',
  UNKNOWN_TIMEZONE: 'UNKNOWN_TIMEZONE',
  TABLE_LABEL_TAKEN: 'TABLE_LABEL_TAKEN',
  TABLE_LIMIT: 'TABLE_LIMIT',
  QR_NOT_CONFIGURED: 'QR_NOT_CONFIGURED',
} as const

export const branchNotFound = () => notFound('This branch')

export const branchChanged = () => versionConflict('This branch')

export const branchArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This branch is archived.')

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

export const tableNotArchived = () =>
  apiError(409, ErrorCodes.INVALID_STATE, 'This table isn\'t archived.')

/** A deployed server without `NUXT_QR_SECRET` (docs/server/operations.md → Configuration). */
export const qrNotConfigured = () =>
  apiError(500, BranchErrorCodes.QR_NOT_CONFIGURED, 'Table QR codes aren\'t set up on this server yet.')
