import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { TenantNotes, TenantOwner } from '#shared/contracts/tenants'
import { notesFormSchema, othersCanSignIn, removalLine, toNotesBody, toNotesForm } from '../schemas/owner-form'

const owner = (id: string, banned = false): TenantOwner => ({ id, name: id, email: `${id}@example.com`, banned, staffAccess: false })
const EMPTY: TenantNotes = { contactName: null, contactPhone: null, notes: null, version: 0, updatedAt: null }

describe('removing an owner', () => {
  it('is possible only while another owner can sign in', () => {
    expect(othersCanSignIn({ owners: [owner('a'), owner('b')] }, owner('a'))).toBe(true)
    expect(othersCanSignIn({ owners: [owner('a'), owner('b', true)] }, owner('a'))).toBe(false)
    expect(othersCanSignIn({ owners: [owner('a', true), owner('b')] }, owner('a'))).toBe(true)
    expect(othersCanSignIn({ owners: [owner('a')] }, owner('a'))).toBe(false)
  })

  it('says what they keep', () => {
    expect(removalLine({ name: 'Sokha', staffAccess: true })).toBe('Sokha keeps their branch roles here, without the owner\'s access.')
    expect(removalLine({ name: 'Bea', staffAccess: false })).toBe('Bea has no access to this cafe afterwards.')
  })
})

describe('internal notes', () => {
  it('show a saved phone without its country code, and send it back in E.164 with blanks as none', () => {
    const form = toNotesForm({ ...EMPTY, contactName: 'Bea', contactPhone: '+85512345678', version: 3 })
    expect(form).toEqual({ contactName: 'Bea', contactPhone: '12 345 678', contactPhoneCountry: 'KH', notes: '' })
    expect(toNotesBody(form, 3)).toEqual({ version: 3, contactName: 'Bea', contactPhone: '+85512345678', notes: null })
    expect(toNotesBody({ ...form, contactName: '  ', contactPhone: ' ' }, 3)).toMatchObject({ contactName: null, contactPhone: null })
  })

  it('refuse a phone that isn\'t one, on the phone field; blank is fine', () => {
    const result = v.safeParse(notesFormSchema, { contactName: '', contactPhone: '012 34', contactPhoneCountry: 'KH', notes: '' })
    expect(result.success).toBe(false)
    expect(v.flatten(result.issues!).nested).toHaveProperty('contactPhone')
    expect(v.safeParse(notesFormSchema, toNotesForm(EMPTY)).success).toBe(true)
  })
})
