import * as v from 'valibot'
import { idSchema, nameSchema, optionalParam, pageQuerySchema, versionSchema } from './common'

/**
 * Staff management (`/api/admin/staff`, D49). A staff member is an account with access: the
 * platform `admin` role and/or a role in one or more branches. Taking all access away ("disable")
 * leaves a plain customer account.
 */

export const BRANCH_ROLES = ['manager', 'staff'] as const
export type BranchRoleName = typeof BRANCH_ROLES[number]

/** List filter: `admin` matches platform admins; `manager` / `staff` match branch roles. */
export const STAFF_ROLE_FILTERS = ['admin', 'manager', 'staff'] as const

export const MAX_MEMBERSHIPS = 50

const membershipSchema = v.object({
  branchId: idSchema,
  role: v.picklist(BRANCH_ROLES, 'Must be manager or staff'),
})

const accessEntries = {
  admin: v.boolean(),
  memberships: v.pipe(
    v.array(membershipSchema),
    v.maxLength(MAX_MEMBERSHIPS, `At most ${MAX_MEMBERSHIPS} branches`),
    v.check(list => new Set(list.map(m => m.branchId)).size === list.length, 'Each branch can be listed only once'),
  ),
}

/** Reported on `memberships` when a person would have no access at all. */
const NO_ACCESS = 'Make them an admin or give them a role in at least one branch'

export const createStaffSchema = v.pipe(
  v.object({
    name: nameSchema(100),
    email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email('Must be a valid email address'), v.maxLength(254)),
    ...accessEntries,
  }),
  v.forward(
    v.partialCheck([['admin'], ['memberships']], input => input.admin || input.memberships.length > 0, NO_ACCESS),
    ['memberships'],
  ),
)
export type CreateStaffInput = v.InferOutput<typeof createStaffSchema>

/** Replaces all of the person's access. `version` is the one read (409 when stale). */
export const updateStaffAccessSchema = v.pipe(
  v.object({ version: versionSchema, ...accessEntries }),
  v.forward(
    v.partialCheck([['admin'], ['memberships']], input => input.admin || input.memberships.length > 0, NO_ACCESS),
    ['memberships'],
  ),
)
export type UpdateStaffAccessInput = v.InferOutput<typeof updateStaffAccessSchema>

export const disableStaffSchema = v.object({ version: versionSchema })
export type DisableStaffInput = v.InferOutput<typeof disableStaffSchema>

export const staffListQuerySchema = v.object({
  ...pageQuerySchema,
  search: optionalParam(v.pipe(v.string(), v.trim(), v.maxLength(100))),
  branchId: optionalParam(idSchema),
  role: optionalParam(v.picklist(STAFF_ROLE_FILTERS)),
})
export type StaffListQuery = v.InferOutput<typeof staffListQuerySchema>

export interface StaffMembership {
  branchId: string
  branchName: string
  role: BranchRoleName
}

export interface StaffMember {
  id: string
  name: string
  email: string
  admin: boolean
  memberships: StaffMembership[]
  /** Still on the temporary password. */
  mustChangePassword: boolean
  /** Send back on update/disable; changes whenever the account changes. */
  version: number
  createdAt: string
}

export interface CreatedStaff {
  staff: StaffMember
  /**
   * Shown to the admin **once**, to hand over; never stored in plain text. `null` when the email
   * already had an account: that person keeps their own password.
   */
  temporaryPassword: string | null
}

/** `GET /api/admin/branches/options`: active branches for pickers. */
export interface BranchOption {
  id: string
  name: string
}
