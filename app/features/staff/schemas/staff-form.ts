import * as v from 'valibot'
import type { BranchRoleName, CreateStaffInput, StaffMember, UpdateStaffAccessInput } from '#shared/contracts/staff'
import { BRANCH_ROLES, MAX_MEMBERSHIPS } from '#shared/contracts/staff'

/**
 * The staff form (D49, D52): who (name and email, on create only) and their access: the admin role
 * and one role per branch. The server checks the same rules and that each branch exists and is
 * active.
 */

const membershipSchema = v.object({
  // '' while the row's branch isn't picked yet.
  branchId: v.pipe(v.string(), v.minLength(1, 'Pick a branch')),
  role: v.picklist(BRANCH_ROLES),
})

const accessSchema = {
  admin: v.boolean(),
  memberships: v.pipe(
    v.array(membershipSchema),
    v.maxLength(MAX_MEMBERSHIPS, `At most ${MAX_MEMBERSHIPS} branches`),
    v.check(list => new Set(list.filter(m => m.branchId).map(m => m.branchId)).size === list.filter(m => m.branchId).length, 'Each branch can be listed only once'),
  ),
}

const NEEDS_ACCESS = 'Make them an admin or give them a role in at least one branch'

export const staffCreateFormSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(100, 'Max 100 characters')),
    email: v.pipe(v.string(), v.trim(), v.minLength(1, 'Email is required'), v.email('Enter an email address'), v.maxLength(254)),
    ...accessSchema,
  }),
  v.forward(v.partialCheck(
    [['admin'], ['memberships']],
    form => form.admin || form.memberships.length > 0,
    NEEDS_ACCESS,
  ), ['memberships']),
)

export const staffAccessFormSchema = v.pipe(
  v.object({ name: v.string(), email: v.string(), ...accessSchema }),
  v.forward(v.partialCheck(
    [['admin'], ['memberships']],
    form => form.admin || form.memberships.length > 0,
    NEEDS_ACCESS,
  ), ['memberships']),
)

export interface StaffForm {
  name: string
  email: string
  admin: boolean
  memberships: { branchId: string, role: BranchRoleName }[]
}

export const ROLE_LABELS: Record<BranchRoleName, string> = { manager: 'Manager', staff: 'Staff' }

/** Initial state: an existing member's access, or a new person with no access yet. */
export function toStaffForm(member?: StaffMember): StaffForm {
  return {
    name: member?.name ?? '',
    email: member?.email ?? '',
    admin: member?.admin ?? false,
    memberships: member?.memberships.map(m => ({ branchId: m.branchId, role: m.role })) ?? [],
  }
}

export function toCreateStaffBody(form: StaffForm): CreateStaffInput {
  return { name: form.name.trim(), email: form.email.trim().toLowerCase(), admin: form.admin, memberships: form.memberships.map(m => ({ ...m })) }
}

/** Access replaces all of the person's roles; `version` is the one the form opened with. */
export function toUpdateStaffAccessBody(form: StaffForm, member: StaffMember): UpdateStaffAccessInput {
  return { version: member.version, admin: form.admin, memberships: form.memberships.map(m => ({ ...m })) }
}

/** "Admin · Manager at Airport · Staff at Riverside", for lists and confirmations. */
export function describeAccess(member: Pick<StaffMember, 'admin' | 'memberships'>): string[] {
  return [
    ...(member.admin ? ['Admin'] : []),
    ...member.memberships.map(m => `${ROLE_LABELS[m.role]} at ${m.branchName}`),
  ]
}
