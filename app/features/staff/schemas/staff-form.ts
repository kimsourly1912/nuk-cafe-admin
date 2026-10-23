import * as v from 'valibot'
import type { BranchRoleName, CreateStaffInput, StaffMember, UpdateStaffAccessInput } from '#shared/contracts/staff'
import { BRANCH_ROLES, MAX_MEMBERSHIPS } from '#shared/contracts/staff'

/**
 * The staff form (D49, D52, D196): who (name and email, on create only), then one access choice:
 * Admin (the whole cafe, every branch), Manager or Staff at the ticked branches, or a different
 * role per branch. It sends the same body as before (`admin` + `memberships`); the server checks
 * the same rules and that each branch exists and is active.
 */

export const ACCESS_CHOICES = ['admin', 'manager', 'staff', 'mixed'] as const
export type AccessChoice = typeof ACCESS_CHOICES[number]

export interface StaffForm {
  name: string
  email: string
  access: AccessChoice
  /** The branches of a Manager or Staff (one role at all of them). */
  branchIds: string[]
  /** One row per branch, for `mixed`. */
  memberships: { branchId: string, role: BranchRoleName }[]
}

const membershipSchema = v.object({
  // '' while the row's branch isn't picked yet.
  branchId: v.pipe(v.string(), v.minLength(1, 'Pick a branch')),
  role: v.picklist(BRANCH_ROLES),
})

const accessEntries = {
  access: v.picklist(ACCESS_CHOICES),
  branchIds: v.pipe(v.array(v.string()), v.maxLength(MAX_MEMBERSHIPS, `At most ${MAX_MEMBERSHIPS} branches`)),
  memberships: v.pipe(
    v.array(membershipSchema),
    v.maxLength(MAX_MEMBERSHIPS, `At most ${MAX_MEMBERSHIPS} branches`),
    v.check(list => new Set(list.filter(m => m.branchId).map(m => m.branchId)).size === list.filter(m => m.branchId).length, 'Each branch can be listed only once'),
  ),
}

// Only the branches of the chosen access are checked: the other list is hidden (and kept, so
// switching back restores it).
const NEEDS_BRANCHES = 'Pick at least one branch'
const NEEDS_ROWS = 'Add at least one branch'

export const staffCreateFormSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(100, 'Max 100 characters')),
    email: v.pipe(v.string(), v.trim(), v.minLength(1, 'Email is required'), v.email('Enter an email address'), v.maxLength(254)),
    ...accessEntries,
  }),
  v.forward(v.partialCheck([['access'], ['branchIds']], form => !isBranchRole(form.access) || form.branchIds.length > 0, NEEDS_BRANCHES), ['branchIds']),
  v.forward(v.partialCheck([['access'], ['memberships']], form => form.access !== 'mixed' || form.memberships.length > 0, NEEDS_ROWS), ['memberships']),
)

export const staffAccessFormSchema = v.pipe(
  v.object({ name: v.string(), email: v.string(), ...accessEntries }),
  v.forward(v.partialCheck([['access'], ['branchIds']], form => !isBranchRole(form.access) || form.branchIds.length > 0, NEEDS_BRANCHES), ['branchIds']),
  v.forward(v.partialCheck([['access'], ['memberships']], form => form.access !== 'mixed' || form.memberships.length > 0, NEEDS_ROWS), ['memberships']),
)

export const ROLE_LABELS: Record<BranchRoleName, string> = { manager: 'Manager', staff: 'Staff' }

/** The choices as the form shows them. Manager and staff have the same counter access today (D196). */
export const ACCESS_LABELS: Record<AccessChoice, { label: string, description: string }> = {
  admin: { label: 'Admin', description: 'Runs the whole cafe: menu, staff, branches, settings, refunds and reports. Works at every branch.' },
  manager: { label: 'Manager', description: 'Leads the counter at their branches. For now, the same access as Staff.' },
  staff: { label: 'Staff', description: 'Works the counter at their branches: orders, payments and sold out.' },
  mixed: { label: 'Different per branch', description: 'Manager at some branches, Staff at others.' },
}

export function isBranchRole(access: AccessChoice): access is BranchRoleName {
  return access === 'manager' || access === 'staff'
}

/**
 * Initial state: an existing member's access, or a new person as Staff with no branch yet. An
 * admin's branch roles (kept by older saves) prefill the branches if they stop being an admin.
 */
export function toStaffForm(member?: StaffMember): StaffForm {
  const memberships = member?.memberships.map(m => ({ branchId: m.branchId, role: m.role })) ?? []
  const roles = new Set(memberships.map(m => m.role))
  const [onlyRole] = roles
  let access: AccessChoice = onlyRole ?? 'staff'
  if (member?.admin) access = 'admin'
  else if (roles.size > 1) access = 'mixed'
  return {
    name: member?.name ?? '',
    email: member?.email ?? '',
    access,
    branchIds: memberships.map(m => m.branchId),
    memberships,
  }
}

/**
 * The state after choosing another access, keeping what was entered: leaving "Different per
 * branch" keeps its branches ticked (incomplete or repeated rows dropped), and entering it starts
 * from the ticked branches, keeping each one's earlier role.
 */
export function switchAccess(form: StaffForm, next: AccessChoice): Pick<StaffForm, 'access' | 'branchIds' | 'memberships'> {
  let { branchIds, memberships } = form
  if (form.access === 'mixed' && next !== 'mixed') {
    memberships = memberships.filter((m, i) => m.branchId && memberships.findIndex(o => o.branchId === m.branchId) === i)
    branchIds = memberships.map(m => m.branchId)
  }
  if (next === 'mixed' && form.access !== 'mixed') {
    const role: BranchRoleName = isBranchRole(form.access) ? form.access : 'staff'
    memberships = branchIds.map(branchId => memberships.find(m => m.branchId === branchId) ?? { branchId, role })
  }
  return { access: next, branchIds: [...branchIds], memberships: memberships.map(m => ({ ...m })) }
}

/** What the API stores: an admin needs no branch role (they work at every branch). */
function toAccess(form: StaffForm): Pick<CreateStaffInput, 'admin' | 'memberships'> {
  const { access } = form
  if (access === 'admin') return { admin: true, memberships: [] }
  if (access === 'mixed') return { admin: false, memberships: form.memberships.map(m => ({ ...m })) }
  return { admin: false, memberships: form.branchIds.map(branchId => ({ branchId, role: access })) }
}

export function toCreateStaffBody(form: StaffForm): CreateStaffInput {
  return { name: form.name.trim(), email: form.email.trim().toLowerCase(), ...toAccess(form) }
}

/** Access replaces all of the person's roles; `version` is the one the form opened with. */
export function toUpdateStaffAccessBody(form: StaffForm, member: StaffMember): UpdateStaffAccessInput {
  return { version: member.version, ...toAccess(form) }
}

/** "Admin · Manager at Airport · Staff at Riverside", for lists and confirmations. */
export function describeAccess(member: Pick<StaffMember, 'admin' | 'memberships'>): string[] {
  return [
    ...(member.admin ? ['Admin'] : []),
    ...member.memberships.map(m => `${ROLE_LABELS[m.role]} at ${m.branchName}`),
  ]
}
