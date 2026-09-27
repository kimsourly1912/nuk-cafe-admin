import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { StaffMember } from '#shared/contracts/staff'
import { describeAccess, staffAccessFormSchema, staffCreateFormSchema, toCreateStaffBody, toStaffForm, toUpdateStaffAccessBody } from '../schemas/staff-form'

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

describe('staff form', () => {
  it('opens with the member\'s access, and a new person with none', () => {
    expect(toStaffForm(member)).toEqual({ name: 'Sophea', email: 'sophea@example.com', admin: false, memberships: [{ branchId: 'b2', role: 'staff' }, { branchId: 'b1', role: 'manager' }] })
    expect(toStaffForm()).toEqual({ name: '', email: '', admin: false, memberships: [] })
  })

  it('needs a name, an email and some access to create', () => {
    const errors = nested(staffCreateFormSchema, { name: ' ', email: 'nope', admin: false, memberships: [] })
    expect(Object.keys(errors)).toEqual(['name', 'email', 'memberships'])
  })

  it('needs each branch row filled in, and each branch once', () => {
    expect(nested(staffAccessFormSchema, { ...toStaffForm(member), memberships: [{ branchId: '', role: 'staff' }] })).toEqual({ 'memberships.0.branchId': ['Pick a branch'] })
    expect(nested(staffAccessFormSchema, { ...toStaffForm(member), memberships: [{ branchId: 'b1', role: 'staff' }, { branchId: 'b1', role: 'manager' }] }))
      .toEqual({ memberships: ['Each branch can be listed only once'] })
  })

  it('accepts an admin with no branch', () => {
    expect(nested(staffAccessFormSchema, { ...toStaffForm(member), admin: true, memberships: [] })).toEqual({})
  })

  it('sends a normalized email on create, and the opened version on update', () => {
    expect(toCreateStaffBody({ name: ' Dara ', email: ' Dara@Example.COM ', admin: true, memberships: [] })).toEqual({ name: 'Dara', email: 'dara@example.com', admin: true, memberships: [] })
    expect(toUpdateStaffAccessBody({ ...toStaffForm(member), admin: true }, member)).toEqual({ version: 1790000000000, admin: true, memberships: [{ branchId: 'b2', role: 'staff' }, { branchId: 'b1', role: 'manager' }] })
  })

  it('describes access in words', () => {
    expect(describeAccess({ admin: true, memberships: member.memberships })).toEqual(['Admin', 'Staff at Riverside', 'Manager at Airport'])
  })
})
