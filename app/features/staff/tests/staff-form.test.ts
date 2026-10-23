import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { StaffMember } from '#shared/contracts/staff'
import { describeAccess, staffAccessFormSchema, staffCreateFormSchema, switchAccess, toCreateStaffBody, toStaffForm, toUpdateStaffAccessBody } from '../schemas/staff-form'
import type { StaffForm } from '../schemas/staff-form'

const member: StaffMember = {
  id: 'u1',
  name: 'Sophea',
  email: 'sophea@example.com',
  admin: false,
  memberships: [{ branchId: 'b2', branchName: 'Riverside', role: 'staff' }, { branchId: 'b1', branchName: 'Airport', role: 'manager' }],
  mustChangePassword: true,
  version: 1790000000000,
  createdAt: '2026-09-27T00:00:00.000Z',
}

const nested = (schema: v.GenericSchema, input: unknown) => {
  const result = v.safeParse(schema, input)
  return (result.success ? {} : v.flatten(result.issues).nested) ?? {}
}

const blank = (changes: Partial<StaffForm>): StaffForm => ({ ...toStaffForm(), name: 'Dara', email: 'dara@example.com', ...changes })

describe('staff form', () => {
  it('opens with one access choice: admin, one role, or a role per branch', () => {
    expect(toStaffForm()).toEqual({ name: '', email: '', access: 'staff', branchIds: [], memberships: [] })
    const staff = { ...member, memberships: [member.memberships[0]!] }
    expect(toStaffForm(staff)).toMatchObject({ access: 'staff', branchIds: ['b2'] })
    expect(toStaffForm(member)).toEqual({
      name: 'Sophea',
      email: 'sophea@example.com',
      access: 'mixed',
      branchIds: ['b2', 'b1'],
      memberships: [{ branchId: 'b2', role: 'staff' }, { branchId: 'b1', role: 'manager' }],
    })
    // An admin's old branch roles prefill the branches if they stop being an admin.
    expect(toStaffForm({ ...member, admin: true })).toMatchObject({ access: 'admin', branchIds: ['b2', 'b1'] })
  })

  it('needs a name, an email and a branch to create a manager or staff', () => {
    const errors = nested(staffCreateFormSchema, { ...toStaffForm(), name: ' ', email: 'nope' })
    expect(errors).toEqual({ name: ['Name is required'], email: ['Enter an email address'], branchIds: ['Pick at least one branch'] })
    expect(nested(staffCreateFormSchema, blank({ access: 'manager', branchIds: ['b1'] }))).toEqual({})
  })

  it('accepts an admin with no branch, and checks only the shown branches', () => {
    expect(nested(staffAccessFormSchema, blank({ access: 'admin' }))).toEqual({})
    // Hidden rows aren't checked while one role is chosen.
    expect(nested(staffAccessFormSchema, blank({ branchIds: ['b1'], memberships: [] }))).toEqual({})
    expect(nested(staffAccessFormSchema, blank({ access: 'mixed', branchIds: ['b1'] }))).toEqual({ memberships: ['Add at least one branch'] })
  })

  it('needs each branch row filled in, and each branch once', () => {
    expect(nested(staffAccessFormSchema, blank({ access: 'mixed', memberships: [{ branchId: '', role: 'staff' }] }))).toEqual({ 'memberships.0.branchId': ['Pick a branch'] })
    expect(nested(staffAccessFormSchema, blank({ access: 'mixed', memberships: [{ branchId: 'b1', role: 'staff' }, { branchId: 'b1', role: 'manager' }] })))
      .toEqual({ memberships: ['Each branch can be listed only once'] })
  })

  it('keeps what was entered when the access changes', () => {
    const staff = blank({ access: 'staff', branchIds: ['b1', 'b2'] })
    // Into "different per branch": the ticked branches, at the role they had.
    expect(switchAccess(staff, 'mixed')).toEqual({ access: 'mixed', branchIds: ['b1', 'b2'], memberships: [{ branchId: 'b1', role: 'staff' }, { branchId: 'b2', role: 'staff' }] })
    const mixed = blank({ access: 'mixed', branchIds: ['b1'], memberships: [{ branchId: 'b1', role: 'manager' }, { branchId: '', role: 'staff' }, { branchId: 'b2', role: 'staff' }, { branchId: 'b2', role: 'manager' }] })
    // Out of it: the picked branches stay ticked; empty and repeated rows go.
    const managers = switchAccess(mixed, 'manager')
    expect(managers).toEqual({ access: 'manager', branchIds: ['b1', 'b2'], memberships: [{ branchId: 'b1', role: 'manager' }, { branchId: 'b2', role: 'staff' }] })
    // And back: each branch keeps its earlier role; an unticked one is dropped.
    expect(switchAccess({ ...mixed, ...managers, branchIds: ['b2'] }, 'mixed').memberships).toEqual([{ branchId: 'b2', role: 'staff' }])
    // Admin and back keeps the branches.
    expect(switchAccess({ ...staff, ...switchAccess(staff, 'admin') }, 'staff').branchIds).toEqual(['b1', 'b2'])
  })

  it('sends the same body as before: admin with no branch role, or a role per branch', () => {
    expect(toCreateStaffBody(blank({ name: ' Dara ', email: ' Dara@Example.COM ', access: 'admin', branchIds: ['b1'] })))
      .toEqual({ name: 'Dara', email: 'dara@example.com', admin: true, memberships: [] })
    expect(toCreateStaffBody(blank({ access: 'manager', branchIds: ['b1', 'b2'] })).memberships)
      .toEqual([{ branchId: 'b1', role: 'manager' }, { branchId: 'b2', role: 'manager' }])
    expect(toUpdateStaffAccessBody(toStaffForm(member), member))
      .toEqual({ version: 1790000000000, admin: false, memberships: [{ branchId: 'b2', role: 'staff' }, { branchId: 'b1', role: 'manager' }] })
  })

  it('describes access in words', () => {
    expect(describeAccess({ admin: true, memberships: member.memberships })).toEqual(['Admin', 'Staff at Riverside', 'Manager at Airport'])
  })
})
